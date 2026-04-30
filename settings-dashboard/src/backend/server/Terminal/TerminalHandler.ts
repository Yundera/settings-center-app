import type { IncomingMessage } from 'http';
import type { Duplex } from 'stream';
import { WebSocketServer, WebSocket } from 'ws';
import * as pty from 'node-pty';

import { verifyToken } from '@/backend/auth/jwt';
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
 * Hook this onto the http.Server's `upgrade` event. Validates the JWT from
 * the `?token=` query string (browsers can't set headers on WebSocket
 * handshakes), then runs an `ssh admin@host` PTY session piped to the WS.
 */
export function handleTerminalUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean {
    if (!req.url) return false;
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== TERMINAL_WS_PATH) return false;

    const token = url.searchParams.get('token');
    if (!token || !verifyToken(token)) {
        socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return true;
    }

    wss.handleUpgrade(req, socket, head, ws => {
        startSession(ws).catch(err => {
            console.error('Terminal session error:', err);
            try { ws.close(); } catch { /* ignore */ }
        });
    });
    return true;
}
