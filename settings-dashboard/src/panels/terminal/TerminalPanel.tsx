import React, { useEffect, useRef, useState } from "react";
import {
    Alert,
    Box,
    Button,
    Card,
    CardContent,
    Stack,
    Typography,
} from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { button, card, colors, font, spacing, text, title } from "@/app/pages/softTheme";

type Status = "connecting" | "open" | "closed" | "error";

/**
 * TerminalPanel — full-screen-ish xterm.js terminal that opens an SSH session
 * to the host as the `admin` sudoer. Backed by /api/terminal/ws (WebSocket
 * upgrade in server.ts → node-pty → ssh -i container_ssh_key admin@host).
 */
export const TerminalPanel: React.FC = () => {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const termRef = useRef<XTerm | null>(null);
    const fitRef = useRef<FitAddon | null>(null);
    const wsRef = useRef<WebSocket | null>(null);
    const [status, setStatus] = useState<Status>("closed");
    const [error, setError] = useState<string | null>(null);
    const [connectKey, setConnectKey] = useState<number>(0);

    useEffect(() => {
        if (!containerRef.current) return;
        if (connectKey === 0) return;

        const term = new XTerm({
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
            fontSize: 13,
            cursorBlink: true,
            scrollback: 5000,
            theme: {
                background: "#0b0f1a",
                foreground: "#e6edf3",
                cursor: "#e6edf3",
                black: "#0b0f1a",
                brightBlack: "#6e7681",
            },
        });
        const fit = new FitAddon();
        term.loadAddon(fit);
        term.open(containerRef.current);
        // Defer first fit until layout settles.
        requestAnimationFrame(() => { try { fit.fit(); } catch { /* ignore */ } });
        termRef.current = term;
        fitRef.current = fit;

        let cancelled = false;
        let ws: WebSocket | null = null;

        (async () => {
            if (cancelled) return;

            // No query-string token: the session cookie attaches to the
            // WebSocket handshake automatically (same-origin). The server
            // verifies it on upgrade.
            const proto = window.location.protocol === "https:" ? "wss" : "ws";
            const url = `${proto}://${window.location.host}/api/terminal/ws`;
            ws = new WebSocket(url);
            ws.binaryType = "arraybuffer";
            wsRef.current = ws;

            ws.onopen = () => {
                if (cancelled) return;
                setStatus("open");
                setError(null);
                // Send initial size.
                const dims = fit.proposeDimensions();
                if (dims) {
                    ws!.send(JSON.stringify({ type: "resize", cols: dims.cols, rows: dims.rows }));
                    term.resize(dims.cols, dims.rows);
                }
                term.focus();
            };
            ws.onmessage = (e) => {
                if (typeof e.data === "string") {
                    term.write(e.data);
                } else {
                    term.write(new Uint8Array(e.data as ArrayBuffer));
                }
            };
            ws.onerror = () => {
                setError("WebSocket error");
                setStatus("error");
            };
            ws.onclose = () => {
                setStatus(prev => (prev === "error" ? "error" : "closed"));
            };
        })();

        const onTermData = term.onData(d => {
            if (ws && ws.readyState === WebSocket.OPEN) ws.send(d);
        });
        const onResize = term.onResize(({ cols, rows }) => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: "resize", cols, rows }));
            }
        });

        const onWindowResize = () => {
            try { fit.fit(); } catch { /* ignore */ }
        };
        window.addEventListener("resize", onWindowResize);

        return () => {
            cancelled = true;
            window.removeEventListener("resize", onWindowResize);
            onTermData.dispose();
            onResize.dispose();
            try { ws?.close(); } catch { /* ignore */ }
            try { term.dispose(); } catch { /* ignore */ }
            wsRef.current = null;
            termRef.current = null;
            fitRef.current = null;
        };
    }, [connectKey]);

    const connect = () => {
        setStatus("connecting");
        setError(null);
        setConnectKey(k => k + 1);
    };

    return (
        <Box sx={{
            paddingTop: spacing.pageY,
            paddingBottom: spacing.pageY,
            paddingX: spacing.pageX,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
        }}>
            <Typography
                variant="h2"
                sx={{
                    textAlign: 'center',
                    fontSize: font.titleLarge,
                    fontWeight: 700,
                    color: colors.textWhite,
                    marginBottom: '30px',
                }}
            >
                Terminal
            </Typography>

            <Box sx={{
                display: 'flex',
                flexDirection: 'column',
                gap: spacing.cardGap,
                maxWidth: '1200px',
                width: '100%',
            }}>
                <Card sx={card.root}>
                    <Box sx={card.header}>
                        <Stack direction="row" alignItems="center" justifyContent="space-between">
                            <Stack direction="row" alignItems="center" spacing={2}>
                                <Typography sx={title.small}>Host shell (admin@host)</Typography>
                                <StatusBadge status={status} />
                            </Stack>
                            <Button
                                onClick={connect}
                                startIcon={<RefreshIcon />}
                                sx={button.primary}
                                disabled={status === "connecting"}
                            >
                                {connectKey === 0 ? "Connect" : "Reconnect"}
                            </Button>
                        </Stack>
                    </Box>
                    <CardContent sx={card.content}>
                        <Typography sx={{ ...text.detail, mb: 1 }}>
                            Interactive shell on the host as the <code>admin</code> sudoer. Use it for maintenance.
                            Closing this page ends the session.
                        </Typography>
                        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
                        <Box
                            ref={containerRef}
                            sx={{
                                width: '100%',
                                height: '70vh',
                                minHeight: 320,
                                borderRadius: 1,
                                overflow: 'hidden',
                                backgroundColor: '#0b0f1a',
                                p: 1,
                            }}
                        />
                    </CardContent>
                </Card>
            </Box>
        </Box>
    );
};

const StatusBadge: React.FC<{ status: Status }> = ({ status }) => {
    const label = status === 'open' ? 'connected'
        : status === 'connecting' ? 'connecting…'
        : status === 'error' ? 'error'
        : 'disconnected';
    const color = status === 'open' ? '#22c55e'
        : status === 'connecting' ? '#eab308'
        : status === 'error' ? '#ef4444'
        : '#94a3b8';
    return (
        <Box sx={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 0.75,
            px: 1.25,
            py: 0.25,
            borderRadius: 999,
            backgroundColor: 'rgba(255,255,255,0.05)',
            border: `1px solid ${color}`,
            fontSize: font.caption,
            color,
        }}>
            <Box sx={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: color }} />
            {label}
        </Box>
    );
};
