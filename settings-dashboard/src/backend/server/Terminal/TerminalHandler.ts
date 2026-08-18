import type { IncomingMessage } from 'http';
import type { Duplex } from 'stream';
import { WebSocketServer, WebSocket } from 'ws';
import * as pty from 'node-pty';

import { readSessionFromHeaders } from '@/backend/auth/session';
import { defaultHostUser, defaultPrivateKeyPath, detectHostIP } from '@/backend/cmd/HostExecutor';

export const TERMINAL_WS_PATH = '/api/terminal/ws';

const wss = new WebSocketServer({ noServer: true });

interface ClientMsg {
    type: 'resize';
    cols: number;
    rows: number;
}

function isClientMsg(value: unknown): value is ClientMsg {
    return (
        typeof value === 'object' && value !== null &&
        (value as { type?: unknown }).type === 'resize' &&
        typeof (value as { cols?: unknown }).cols === 'number' &&
        typeof (value as { rows?: unknown }).rows === 'number'
    );
}

async function startSession(ws: WebSocket): Promise<void> {
    let host: string;
    try {
        host = await detectHostIP();
    } catch (err) {
        ws.send(`\r\n\x1b[31mFailed to resolve host: ${(err as Error).message}\x1b[0m\r\n`);
        ws.close();
        return;
    }

    const proc = pty.spawn(
        'ssh',
        [
            '-i', defaultPrivateKeyPath,
            '-o', 'StrictHostKeyChecking=no',
            '-o', 'BatchMode=yes',
            '-o', 'ServerAliveInterval=30',
            '-tt',
            `${defaultHostUser}@${host}`,
        ],
        {
            name: 'xterm-256color',
            cols: 80,
            rows: 24,
            cwd: '/app',
            env: { ...process.env, TERM: 'xterm-256color' } as { [k: string]: string },
        },
    );

    proc.onData(data => {
        if (ws.readyState === ws.OPEN) ws.send(data);
    });
    proc.onExit(({ exitCode, signal }) => {
        if (ws.readyState === ws.OPEN) {
            ws.send(`\r\n\x1b[90m[session ended — exit ${exitCode}${signal ? `, signal ${signal}` : ''}]\x1b[0m\r\n`);
            ws.close();
        }
    });

    ws.on('message', raw => {
        const text = typeof raw === 'string' ? raw : raw.toString('utf8');
        if (text.length > 0 && text.charCodeAt(0) === 0x7b /* '{' */) {
            try {
                const parsed = JSON.parse(text);
                if (isClientMsg(parsed)) {
                    proc.resize(Math.max(1, Math.min(500, parsed.cols)), Math.max(1, Math.min(500, parsed.rows)));
                    return;
                }
            } catch {
                // fall through — treat as literal input
            }
        }
        proc.write(text);
    });

    ws.on('close', () => {
        try { proc.kill(); } catch { /* ignore */ }
    });
}

/**
 * Hook this onto the http.Server's `upgrade` event. Validates the session
 * cookie (same one used by the rest of the app — browsers attach it to the
 * WebSocket handshake automatically), then runs an `ssh admin@host` PTY
 * session piped to the WS.
 */
export function handleTerminalUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean {
    if (!req.url) return false;
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== TERMINAL_WS_PATH) return false;

    // jwtVerify is async; the upgrade callback isn't, so we hand the request
    // to an async closure and decide there. We must respond on `socket`
    // ourselves either way because we've claimed the upgrade.
    (async () => {
        // The AppShield gate authenticates the upgrade request itself (nginx
        // auth_request runs before the proxy pass), and forwards the identity
        // assertion on it like any other request — so the same check the HTTP
        // routes use applies here. It has to be done again on our side because
        // a WebSocket upgrade never passes through Next's middleware.
        const user = await readSessionFromHeaders(req.headers);
        if (!user) {
            socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
            socket.destroy();
            return;
        }
        wss.handleUpgrade(req, socket, head, ws => {
            startSession(ws).catch(err => {
                console.error('Terminal session error:', err);
                try { ws.close(); } catch { /* ignore */ }
            });
        });
    })();
    return true;
}
