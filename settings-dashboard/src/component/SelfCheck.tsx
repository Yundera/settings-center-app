import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
    Button,
    Typography,
    CircularProgress,
    Alert,
    Stack,
    Card,
    CardContent,
    Box,
    TextField,
} from "@mui/material";
import { apiRequest } from "@/core/authApi";
import { useNotify } from "react-admin";
import { colors, font, spacing, card, title, button, text } from '@/app/pages/softTheme';
import { SelfCheckRunSummary } from "@/component/SelfCheckRunSummary";
import type { SelfCheckRun } from "@/backend/server/Health/SelfCheckLog";

const LOG_TAIL_LINES = 300;
// Poll fast while something is actually happening (a run in flight, or the raw
// log open and being watched); back off otherwise — the nightly run only
// changes the summary once a day.
const ACTIVE_REFRESH_MS = 5000;
const IDLE_REFRESH_MS = 30000;

interface CronInfo {
    value: string;
    effective: string;
    default: string;
}

/**
 * SelfCheck — "System Status" card on the Health page.
 *
 * The host script (self-check.sh) is the source of truth: it runs nightly
 * via cron and at @reboot, and writes structured output to yundera.log.
 * This component shows the parsed summary of the last run (see
 * backend/server/Health/SelfCheckLog.ts) and exposes:
 *   - "Run now" (kicks off self-check.sh detached)
 *   - cron schedule input (writes SELF_CHECK_CRON in .pcs.env, then re-runs
 *     ensure-nightly-self-check.sh to apply)
 *
 * The raw log tail is still available behind a toggle, and is only fetched
 * while it's open — the summary endpoint returns a compact JSON run instead
 * of shipping the whole tail to the browser every 5s.
 */
export const SelfCheck: React.FC = () => {
    const [run, setRun] = useState<SelfCheckRun | null>(null);
    const [summaryError, setSummaryError] = useState<string | null>(null);
    const [summaryLoading, setSummaryLoading] = useState<boolean>(true);

    const [log, setLog] = useState<string>('');
    const [logError, setLogError] = useState<string | null>(null);
    const [logLoading, setLogLoading] = useState<boolean>(false);
    const [showRawLog, setShowRawLog] = useState<boolean>(false);
    const [running, setRunning] = useState<boolean>(false);

    const [cron, setCron] = useState<CronInfo | null>(null);
    const [cronInput, setCronInput] = useState<string>('');
    const [cronSaving, setCronSaving] = useState<boolean>(false);
    const [cronError, setCronError] = useState<string | null>(null);

    const notify = useNotify();
    const logRef = useRef<HTMLPreElement | null>(null);

    const fetchSummary = useCallback(async () => {
        try {
            const res = await apiRequest<{ run: SelfCheckRun | null }>(
                "/api/admin/self-check-summary",
                "GET"
            );
            setRun(res.run ?? null);
            setSummaryError(null);
        } catch (err: any) {
            setSummaryError(err.message || 'Failed to read self-check status');
        } finally {
            setSummaryLoading(false);
        }
    }, []);

    const fetchLog = useCallback(async () => {
        setLogLoading(true);
        try {
            const res = await apiRequest<{ log: string }>(
                `/api/admin/self-check-log?lines=${LOG_TAIL_LINES}`,
                "GET"
            );
            setLog(res.log || '');
            setLogError(null);
        } catch (err: any) {
            setLogError(err.message || 'Failed to read log');
        } finally {
            setLogLoading(false);
        }
    }, []);

    const fetchCron = useCallback(async () => {
        try {
            const res = await apiRequest<CronInfo>("/api/admin/self-check-cron", "GET");
            setCron(res);
            setCronInput(res.value);
            setCronError(null);
        } catch (err: any) {
            setCronError(err.message || 'Failed to read cron schedule');
        }
    }, []);

    const handleRun = async () => {
        setRunning(true);
        try {
            await apiRequest("/api/admin/self-check-run", "POST");
            notify('Self-check started');
            // Give the host a moment to start writing, then pick up the
            // in-progress run — the 5s poll takes over from there.
            setTimeout(() => {
                void fetchSummary();
                if (showRawLog) void fetchLog();
            }, 1500);
        } catch (err: any) {
            notify(err.message || 'Failed to start self-check', { type: 'error' });
        } finally {
            setRunning(false);
        }
    };

    const handleSaveCron = async () => {
        setCronSaving(true);
        setCronError(null);
        try {
            await apiRequest<{ status: string; value: string }>(
                "/api/admin/self-check-cron",
                "POST",
                { value: cronInput.trim() }
            );
            notify('Schedule updated');
            await fetchCron();
        } catch (err: any) {
            setCronError(err.message || 'Failed to update schedule');
        } finally {
            setCronSaving(false);
        }
    };

    useEffect(() => {
        fetchCron();
    }, [fetchCron]);

    // Poll the parsed summary; poll the raw tail only while the raw panel is
    // open, so a collapsed panel costs nothing on the host.
    const runInProgress = run?.status === 'running';
    useEffect(() => {
        const tick = () => {
            void fetchSummary();
            if (showRawLog) void fetchLog();
        };
        tick();
        const interval = setInterval(
            tick,
            runInProgress || showRawLog ? ACTIVE_REFRESH_MS : IDLE_REFRESH_MS
        );
        return () => clearInterval(interval);
    }, [fetchSummary, fetchLog, showRawLog, runInProgress]);

    // Keep the log scrolled to the bottom on update.
    useEffect(() => {
        if (logRef.current) {
            logRef.current.scrollTop = logRef.current.scrollHeight;
        }
    }, [log]);

    return (
        <Card sx={card.root}>
            <Box sx={card.header}>
                <Typography sx={title.small}>System Status</Typography>
            </Box>
            <CardContent sx={card.content}>
                <Stack sx={{ gap: spacing.itemGap }}>
                    {/* Schedule + run-now controls */}
                    <Stack direction="row" alignItems="flex-end" spacing={2} flexWrap="wrap">
                        <TextField
                            label="Nightly schedule (cron)"
                            value={cronInput}
                            onChange={(e) => setCronInput(e.target.value)}
                            placeholder={cron?.default || '0 3 * * *'}
                            disabled={cronSaving}
                            size="small"
                            sx={{ minWidth: 220 }}
                            helperText={
                                cron
                                    ? `Effective: ${cron.effective}${cron.value === '' ? ' (default)' : ''}`
                                    : ' '
                            }
                        />
                        <Button
                            variant="contained"
                            onClick={handleSaveCron}
                            disabled={cronSaving || cronInput === (cron?.value ?? '')}
                            sx={button.primary}
                        >
                            {cronSaving ? 'Saving…' : 'Save'}
                        </Button>
                        <Box sx={{ flexGrow: 1 }} />
                        <Button
                            variant="contained"
                            onClick={handleRun}
                            disabled={running}
                            sx={button.primary}
                        >
                            {running ? 'Starting…' : 'Run now'}
                        </Button>
                    </Stack>

                    {cronError && <Alert severity="error">{cronError}</Alert>}

                    <Typography variant="body2" sx={text.detail}>
                        Tip: leave the schedule blank for the default ({cron?.default || '0 3 * * *'})
                        or set to <code>disabled</code> to skip nightly runs. The @reboot run is
                        always installed.
                    </Typography>

                    {/* Parsed summary of the last run */}
                    <Box>
                        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
                            <Typography sx={text.label}>Last self-check</Typography>
                            {summaryLoading && <CircularProgress size={16} />}
                        </Stack>
                        {summaryError && <Alert severity="error" sx={{ mb: 1 }}>{summaryError}</Alert>}
                        {!summaryLoading && !summaryError && <SelfCheckRunSummary run={run} />}
                    </Box>

                    {/* Raw log tail — the summary above is derived from it */}
                    <Box>
                        <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 1 }}>
                            <Typography
                                onClick={() => setShowRawLog(!showRawLog)}
                                sx={{ ...text.label, cursor: 'pointer', color: colors.primary }}
                            >
                                {showRawLog ? 'Hide raw log' : 'Show raw log'}
                            </Typography>
                            {showRawLog && logLoading && <CircularProgress size={16} />}
                        </Stack>
                        {showRawLog && (
                            <>
                                {logError && <Alert severity="error" sx={{ mb: 1 }}>{logError}</Alert>}
                                <Box
                                    component="pre"
                                    ref={logRef}
                                    sx={{
                                        m: 0,
                                        p: 2,
                                        maxHeight: 400,
                                        overflow: 'auto',
                                        backgroundColor: colors.bgApp,
                                        color: colors.textWhite,
                                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
                                        fontSize: font.caption,
                                        lineHeight: 1.5,
                                        borderRadius: 1,
                                        whiteSpace: 'pre-wrap',
                                        wordBreak: 'break-word',
                                    }}
                                >
                                    {log || (logLoading ? '' : '(log is empty)')}
                                </Box>
                            </>
                        )}
                    </Box>
                </Stack>
            </CardContent>
        </Card>
    );
};
