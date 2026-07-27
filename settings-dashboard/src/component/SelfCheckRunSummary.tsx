import React, { useState } from 'react';
import {
    Typography,
    Chip,
    Stack,
    Box,
    Collapse,
    LinearProgress,
    IconButton,
} from "@mui/material";
import {
    CheckCircle as CheckCircleIcon,
    Cancel as CancelIcon,
    Autorenew as AutorenewIcon,
    ExpandMore as ExpandMoreIcon,
} from "@mui/icons-material";
import { colors, font, chip, text } from '@/app/pages/softTheme';
import type { ScriptResult, SelfCheckRun } from '@/backend/server/Health/SelfCheckLog';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Format a host-local "YYYY-MM-DDTHH:mm:ss" stamp for display.
 *
 * Deliberately NOT via Date/toLocaleString: the log carries no timezone, so
 * parsing it would silently reinterpret host time as browser time and shift
 * the clock. What the host wrote is what we show.
 */
function formatStamp(stamp: string | null, withDate = true): string {
    if (!stamp) return '—';
    const m = stamp.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/);
    if (!m) return stamp;
    const [, , month, day, hh, mm, ss] = m;
    const clock = `${hh}:${mm}:${ss}`;
    if (!withDate) return clock;
    return `${parseInt(day, 10)} ${MONTHS[parseInt(month, 10) - 1]} ${clock}`;
}

function formatDuration(seconds: number | null): string {
    if (seconds === null) return '—';
    if (seconds < 60) return `${seconds}s`;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    if (m < 60) return s ? `${m}m ${s}s` : `${m}m`;
    const h = Math.floor(m / 60);
    return `${h}h ${m % 60}m`;
}

const statusColor = (status: SelfCheckRun['status']): string => {
    switch (status) {
        case 'success': return colors.statusSuccess;
        case 'failures': return colors.statusError;
        default: return colors.statusInfo;
    }
};

const statusLabel = (run: SelfCheckRun): string => {
    switch (run.status) {
        case 'success': return 'All checks passed';
        case 'failures': return `${run.failed} check${run.failed === 1 ? '' : 's'} failed`;
        default: return 'Running…';
    }
};

const scriptIcon = (status: ScriptResult['status']) => {
    const sx = { width: '16px', height: '16px', flexShrink: 0 };
    switch (status) {
        case 'success':
            return <CheckCircleIcon sx={{ ...sx, color: colors.statusSuccess }} />;
        case 'failed':
            return <CancelIcon sx={{ ...sx, color: colors.statusError }} />;
        default:
            return <AutorenewIcon sx={{ ...sx, color: colors.statusInfo }} />;
    }
};

/**
 * One script row. Failed and still-running scripts carry the captured output
 * from the host log and expand to show it; successful ones have nothing to
 * show (the host stays quiet on success by convention).
 */
const ScriptRow: React.FC<{ script: ScriptResult }> = ({ script }) => {
    const [open, setOpen] = useState(false);
    const expandable = script.output.length > 0;

    return (
        <Box
            sx={{
                borderBottom: `1px solid ${colors.borderMuted}`,
                '&:last-of-type': { borderBottom: 'none' },
            }}
        >
            <Box
                onClick={expandable ? () => setOpen(!open) : undefined}
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    py: '7px',
                    cursor: expandable ? 'pointer' : 'default',
                    '&:hover': expandable ? { backgroundColor: colors.bgOverlay } : undefined,
                }}
            >
                {scriptIcon(script.status)}
                <Typography
                    sx={{
                        fontSize: font.detail,
                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                        color: script.status === 'failed' ? colors.statusError : colors.textWhite,
                        flexGrow: 1,
                        minWidth: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                    }}
                >
                    {script.name}
                </Typography>

                {script.exitCode !== null && (
                    <Chip
                        label={`exit ${script.exitCode}`}
                        size="small"
                        variant="outlined"
                        sx={{
                            ...chip.tag,
                            border: `1px solid ${colors.statusError} !important`,
                            color: `${colors.statusError} !important`,
                            '& .MuiChip-label': { color: `${colors.statusError} !important` },
                        }}
                    />
                )}

                <Typography sx={{ ...text.detail, fontSize: font.caption, flexShrink: 0 }}>
                    {script.status === 'running' ? 'running…' : formatDuration(script.durationSec)}
                </Typography>

                <Box sx={{ width: '24px', flexShrink: 0, display: 'flex', justifyContent: 'center' }}>
                    {expandable && (
                        <IconButton size="small" sx={{ p: 0, color: colors.textMuted }}>
                            <ExpandMoreIcon
                                sx={{
                                    width: '18px',
                                    height: '18px',
                                    transform: open ? 'rotate(180deg)' : 'none',
                                    transition: 'transform 0.15s ease',
                                }}
                            />
                        </IconButton>
                    )}
                </Box>
            </Box>

            {expandable && (
                <Collapse in={open} unmountOnExit>
                    <Box
                        component="pre"
                        sx={{
                            m: 0,
                            mb: '10px',
                            p: '12px',
                            maxHeight: 260,
                            overflow: 'auto',
                            backgroundColor: colors.bgApp,
                            color: colors.textMuted,
                            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                            fontSize: font.caption,
                            lineHeight: 1.5,
                            borderRadius: 1,
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                        }}
                    >
                        {script.outputTruncated && `… earlier output omitted …\n`}
                        {script.output.join('\n')}
                    </Box>
                </Collapse>
            )}
        </Box>
    );
};

/**
 * SelfCheckRunSummary — reads the parsed last self-check run and renders the
 * verdict plus a per-script pass/fail list, so the trail in yundera.log
 * doesn't have to be read by eye.
 *
 * Purely presentational; the parent owns fetching and polling.
 */
export const SelfCheckRunSummary: React.FC<{ run: SelfCheckRun | null }> = ({ run }) => {
    const [showAll, setShowAll] = useState(false);

    if (!run) {
        return (
            <Typography variant="body2" sx={text.detail}>
                No self-check run found in the log yet.
            </Typography>
        );
    }

    const failedScripts = run.scripts.filter((s) => s.status === 'failed');
    const running = run.status === 'running';
    const currentScript = running
        ? run.scripts.find((s) => s.status === 'running')
        : undefined;

    // Failures and the in-flight script are always visible; when there is
    // something wrong, the long tail of passing scripts collapses behind a
    // toggle so the problem isn't buried in 27 green rows.
    const problems = run.scripts.filter((s) => s.status !== 'success');
    const hasProblems = problems.length > 0;
    const visible = hasProblems && !showAll ? problems : run.scripts;
    const hidden = run.scripts.length - visible.length;

    return (
        <Stack sx={{ gap: '12px' }}>
            {/* Verdict */}
            <Stack direction="row" alignItems="center" spacing={2} flexWrap="wrap" useFlexGap>
                <Chip
                    label={statusLabel(run)}
                    variant="outlined"
                    sx={{
                        ...chip.status,
                        border: `1px solid ${statusColor(run.status)} !important`,
                        color: `${statusColor(run.status)} !important`,
                        '& .MuiChip-label': { color: `${statusColor(run.status)} !important` },
                    }}
                />
                <Typography sx={text.label}>
                    {run.passed}/{run.total} scripts
                    {running && run.scripts.some((s) => s.status === 'running') ? ' so far' : ''}
                </Typography>
            </Stack>

            {/* When / how long. startedAt is null only on a truncated run. */}
            <Typography variant="body2" sx={text.detail}>
                {run.startedAt
                    ? `${running ? 'Started' : 'Ran'} ${formatStamp(run.startedAt)}`
                    : `Finished ${formatStamp(run.endedAt)}`}
                {run.startedAt && run.endedAt && ` → ${formatStamp(run.endedAt, false)}`}
                {run.durationSec !== null && ` · took ${formatDuration(run.durationSec)}`}
                {' '}(host time)
            </Typography>

            {running && (
                <Box>
                    <LinearProgress sx={{ height: 4, borderRadius: 2 }} />
                    {currentScript && (
                        <Typography variant="body2" sx={{ ...text.detail, mt: '6px' }}>
                            Currently running: {currentScript.name}
                        </Typography>
                    )}
                </Box>
            )}

            {run.truncated && (
                <Typography variant="body2" sx={{ ...text.detail, color: colors.statusWarning }}>
                    The start of this run is outside the log window — the list below is partial.
                </Typography>
            )}

            {failedScripts.length > 0 && (
                <Typography variant="body2" sx={{ ...text.detail, color: colors.statusError }}>
                    Failed: {failedScripts.map((s) => s.name).join(', ')} — expand a row for its output.
                </Typography>
            )}

            {/* Per-script trail */}
            {run.scripts.length > 0 && (
                <Box
                    sx={{
                        border: `1px solid ${colors.borderMuted}`,
                        borderRadius: 1,
                        px: '12px',
                        maxHeight: 420,
                        overflowY: 'auto',
                    }}
                >
                    {visible.map((script, i) => (
                        <ScriptRow key={`${script.name}-${i}`} script={script} />
                    ))}
                </Box>
            )}

            {hasProblems && (
                <Typography
                    variant="body2"
                    onClick={() => setShowAll(!showAll)}
                    sx={{ ...text.detail, cursor: 'pointer', color: colors.primary, width: 'fit-content' }}
                >
                    {showAll
                        ? 'Show only problems'
                        : `Show all ${run.scripts.length} scripts (${hidden} passing hidden)`}
                </Typography>
            )}
        </Stack>
    );
};
