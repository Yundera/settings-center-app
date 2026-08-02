import React, { useState, useEffect, useRef } from 'react';
import {
    Alert,
    Box,
    Button,
    Card,
    CardContent,
    Chip,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    IconButton,
    LinearProgress,
    Stack,
    TextField,
    Tooltip,
    Typography,
} from '@mui/material';
import {
    CheckCircle as CheckCircleIcon,
    ContentCopy as ContentCopyIcon,
    Error as ErrorIcon,
    OpenInNew as OpenInNewIcon,
    RadioButtonUnchecked as PendingIcon,
    Schedule as RunningIcon,
    RemoveCircle as SkippedIcon,
} from '@mui/icons-material';
import { useNotify } from 'react-admin';
import { useSearchParams } from 'react-router-dom';
import { apiRequest } from '@/core/authApi';
import { useBrand } from '@/core/configuration/brandContext';
import {
    colors,
    font,
    spacing,
    card,
    title,
    button,
    chip as chipStyle,
    icon as iconStyle,
    text,
} from '@/app/pages/softTheme';
import {
    MigrationStatus,
    MIGRATION_STEPS,
    MIGRATION_STEP_PHASES,
    MigrationStepPhase,
    MigrationStepStatus,
    PreflightResult,
} from '@/backend/server/Migration/MigrationTypes';

const DEFAULT_STATUS: MigrationStatus = {
    phase: 'idle',
    steps: {},
    cancelRequested: false,
};

export const MigrationPanel: React.FC = () => {
    const notify = useNotify();
    const [searchParams] = useSearchParams();
    // Prefill from query string: ?ip=...&user=...&pwd=...&webhook=...
    //
    // The migration password lives in the URL by design: the dashboard already
    // shows it in plaintext and the orchestrator emails it in plaintext too,
    // so URL exposure is the same risk class as those — and including it here
    // makes the deeplink a one-click flow (paste isn't required). The
    // migration account is single-use and gets deleted at the end of the
    // pipeline; even if the URL leaks via browser history, the credential
    // is dead by then.
    const [host, setHost] = useState(() => searchParams.get('ip') || searchParams.get('host') || '');
    const [user, setUser] = useState(() => searchParams.get('user') || '');
    const [password, setPassword] = useState(() => searchParams.get('pwd') || searchParams.get('password') || '');
    const [webhookUrl, setWebhookUrl] = useState(() => searchParams.get('webhook') || '');
    const [preflight, setPreflight] = useState<PreflightResult | null>(null);
    const [preflightLoading, setPreflightLoading] = useState(false);
    const [starting, setStarting] = useState(false);
    const [status, setStatus] = useState<MigrationStatus>(DEFAULT_STATUS);
    const [error, setError] = useState<string | null>(null);
    const pollingRef = useRef<NodeJS.Timeout | null>(null);

    const fetchStatus = async () => {
        try {
            const s = await apiRequest<MigrationStatus>('/api/admin/migration/status', 'GET');
            setStatus(s);
        } catch (err: any) {
            setError(err.message || 'Failed to fetch status');
        }
    };

    useEffect(() => {
        fetchStatus();
    }, []);

    useEffect(() => {
        const active = isActivePhase(status.phase);
        if (active && !pollingRef.current) {
            pollingRef.current = setInterval(fetchStatus, 2000);
        } else if (!active && pollingRef.current) {
            clearInterval(pollingRef.current);
            pollingRef.current = null;
        }
        return () => {
            if (pollingRef.current) {
                clearInterval(pollingRef.current);
                pollingRef.current = null;
            }
        };
    }, [status.phase]);

    const handlePreflight = async () => {
        setError(null);
        setPreflight(null);
        setPreflightLoading(true);
        try {
            const r = await apiRequest<PreflightResult>('/api/admin/migration/preflight', 'POST', {
                host,
                user,
                password,
            });
            setPreflight(r);
            if (r.ok) notify('Preflight passed', { type: 'success' });
            else notify('Preflight failed — see details', { type: 'warning' });
        } catch (err: any) {
            setError(err.message || 'Preflight failed');
        } finally {
            setPreflightLoading(false);
        }
    };

    const handleStart = async () => {
        setError(null);
        setStarting(true);
        try {
            const s = await apiRequest<MigrationStatus>('/api/admin/migration/start', 'POST', {
                host,
                user,
                password,
                webhookUrl: webhookUrl.trim() || undefined,
            });
            setStatus(s);
            // Clear password from state once the migration owns it server-side
            setPassword('');
        } catch (err: any) {
            setError(err.message || 'Failed to start migration');
        } finally {
            setStarting(false);
        }
    };

    const handleCancel = async () => {
        try {
            await apiRequest('/api/admin/migration/cancel', 'POST');
            notify('Cancel requested');
            await fetchStatus();
        } catch (err: any) {
            setError(err.message || 'Cancel failed');
        }
    };

    const phaseActive = isActivePhase(status.phase);
    const canStart = preflight?.ok && !phaseActive && host && user && password;

    return (
        <Box sx={{
            paddingTop: spacing.pageY,
            paddingBottom: spacing.pageY,
            paddingX: spacing.pageX,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
        }}>
            <Typography sx={{
                ...title.large,
                textAlign: 'center',
                marginBottom: '15px',
            }}>
                Migration
            </Typography>
            <Typography sx={{
                ...text.detail,
                textAlign: 'center',
                maxWidth: '800px',
                marginBottom: '30px',
            }}>
                Move this PCS — domain, apps, and data — onto another PCS. The destination only
                needs SSH and a sudoer account; this PCS does the work and hands over.
            </Typography>

            {error && (
                <Alert severity="error" sx={{ mb: 2, maxWidth: '800px', width: '100%' }}>{error}</Alert>
            )}

            <Box sx={{
                display: 'flex',
                flexDirection: 'column',
                gap: spacing.cardGap,
                maxWidth: '800px',
                width: '100%',
            }}>
                <MigrationIntroCard />

                <MigrationSourceAccount />

                <Card sx={card.root}>
                    <Box sx={card.header}>
                        <Typography sx={title.small}>Migrate OUT of this PCS</Typography>
                    </Box>
                    <CardContent sx={card.content}>
                        <Typography sx={{ ...text.bodyMuted, mb: 2 }}>
                            Push this PCS&apos; data and identity to another PCS. Enter the
                            destination&apos;s migration account credentials below
                            (or arrive here via the prefilled link from the destination&apos;s panel).
                        </Typography>
                        <Stack spacing={2}>
                            <TextField
                                label="Destination host or IP"
                                value={host}
                                onChange={e => setHost(e.target.value)}
                                disabled={phaseActive}
                                fullWidth
                                size="small"
                            />
                            <TextField
                                label="Destination migration user"
                                value={user}
                                onChange={e => setUser(e.target.value)}
                                disabled={phaseActive}
                                fullWidth
                                size="small"
                                helperText="Default: 'migration' (created on the destination via its Migration panel)"
                            />
                            <TextField
                                label="Destination migration password"
                                type="password"
                                value={password}
                                onChange={e => setPassword(e.target.value)}
                                disabled={phaseActive}
                                fullWidth
                                size="small"
                                helperText="Used once to install an SSH key on the destination. Never stored."
                            />
                            <TextField
                                label="Webhook URL (optional, HTTPS)"
                                value={webhookUrl}
                                onChange={e => setWebhookUrl(e.target.value)}
                                disabled={phaseActive}
                                fullWidth
                                size="small"
                                placeholder="https://example.com/hooks/migration"
                            />
                            <Stack direction="row" spacing={2}>
                                <Button
                                    variant="outlined"
                                    onClick={handlePreflight}
                                    disabled={!host || !user || !password || preflightLoading || phaseActive}
                                    startIcon={preflightLoading ? <CircularProgress size={16} /> : undefined}
                                    sx={outlineButton}
                                >
                                    Test connection
                                </Button>
                                <Button
                                    onClick={handleStart}
                                    disabled={!canStart || starting}
                                    startIcon={starting ? <CircularProgress size={16} /> : undefined}
                                    sx={button.primary}
                                >
                                    Start migration
                                </Button>
                                {phaseActive && (
                                    <Button
                                        variant="outlined"
                                        onClick={handleCancel}
                                        disabled={status.cancelRequested}
                                        sx={dangerButton}
                                    >
                                        {status.cancelRequested ? 'Cancelling…' : 'Cancel'}
                                    </Button>
                                )}
                            </Stack>
                        </Stack>
                    </CardContent>
                </Card>

                {preflight && <PreflightResultCard result={preflight} />}

                {status.phase !== 'idle' && <MigrationStatusCard status={status} />}

                <MigrationStepsReferenceCard />
            </Box>
        </Box>
    );
};

const PreflightResultCard: React.FC<{ result: PreflightResult }> = ({ result }) => {
    const statusColor = result.ok ? colors.statusSuccess : colors.statusErrorAlt;
    return (
        <Card sx={card.root}>
            <Box sx={card.header}>
                <Stack direction="row" alignItems="center" justifyContent="space-between">
                    <Typography sx={title.small}>Preflight</Typography>
                    <Chip
                        label={result.ok ? 'OK' : 'FAILED'}
                        variant="outlined"
                        size="small"
                        sx={statusChipSx(statusColor)}
                    />
                </Stack>
            </Box>
            <CardContent sx={card.content}>
                <Stack sx={{ gap: spacing.itemGap }}>
                    {result.checks.map(c => (
                        <Box key={c.name} sx={{ display: 'flex', flexDirection: 'row', alignItems: 'flex-start' }}>
                            <Box sx={iconStyle.container}>
                                {c.ok
                                    ? <CheckCircleIcon sx={{ color: colors.statusSuccess, ...iconStyle.size }} />
                                    : <ErrorIcon sx={{ color: colors.statusErrorAlt, ...iconStyle.size }} />}
                            </Box>
                            <Box>
                                <Typography sx={text.label}>{c.name}</Typography>
                                <Typography sx={text.detail}>{c.message}</Typography>
                            </Box>
                        </Box>
                    ))}
                </Stack>
            </CardContent>
        </Card>
    );
};

const MigrationStatusCard: React.FC<{ status: MigrationStatus }> = ({ status }) => {
    const phaseLabel = status.phase.replace(/_/g, ' ').toUpperCase();
    const statusColor = phaseColorFor(status.phase);

    return (
        <Card sx={card.root}>
            <Box sx={card.header}>
                <Stack direction="row" alignItems="center" justifyContent="space-between">
                    <Typography sx={title.small}>Migration status</Typography>
                    <Stack direction="row" alignItems="center" spacing={1}>
                        <Chip
                            label={phaseLabel}
                            variant="outlined"
                            size="small"
                            sx={statusChipSx(statusColor)}
                        />
                        {isActivePhase(status.phase) && <CircularProgress size={16} sx={{ color: colors.textWhite }} />}
                    </Stack>
                </Stack>
            </Box>
            <CardContent sx={card.content}>
                <Stack sx={{ gap: spacing.itemGap }}>
                    {status.error && <Alert severity="error">{status.error}</Alert>}

                    {status.rsync && (
                        <Box>
                            <Typography sx={{ ...text.detail, mb: 1 }}>
                                rsync: {formatBytes(status.rsync.bytesTransferred)}
                                {status.rsync.percent !== undefined && ` · ${status.rsync.percent}%`}
                                {status.rsync.throughput && ` · ${status.rsync.throughput}`}
                                {status.rsync.eta && ` · ETA ${status.rsync.eta}`}
                            </Typography>
                            <LinearProgress
                                variant={status.rsync.percent !== undefined ? 'determinate' : 'indeterminate'}
                                value={status.rsync.percent ?? 0}
                            />
                        </Box>
                    )}

                    <PhaseLegend />

                    {MIGRATION_STEPS.map(({ key, label, phase }) => {
                        const step = status.steps[key];
                        return (
                            <Box key={key} sx={{
                                display: 'flex',
                                flexDirection: 'row',
                                alignItems: 'flex-start',
                                borderLeft: `3px solid ${phaseGroupColor(phase)}`,
                                pl: 1,
                            }}>
                                <Box sx={iconStyle.container}>{stepIcon(step?.status)}</Box>
                                <Box>
                                    <Typography sx={text.label}>{label}</Typography>
                                    {step?.message && <Typography sx={text.detail}>{step.message}</Typography>}
                                </Box>
                            </Box>
                        );
                    })}

                    {status.startedAt && (
                        <Typography sx={{ ...text.detail, fontSize: font.caption }}>
                            Started: {new Date(status.startedAt).toLocaleString()}
                            {status.finishedAt && ` · Finished: ${new Date(status.finishedAt).toLocaleString()}`}
                        </Typography>
                    )}
                </Stack>
            </CardContent>
        </Card>
    );
};

function stepIcon(s?: MigrationStepStatus) {
    const sx = iconStyle.size;
    switch (s) {
        case 'success':
            return <CheckCircleIcon sx={{ color: colors.statusSuccess, ...sx }} />;
        case 'failed':
            return <ErrorIcon sx={{ color: colors.statusErrorAlt, ...sx }} />;
        case 'running':
            return <RunningIcon sx={{ color: colors.statusInfo, ...sx }} />;
        case 'skipped':
            return <SkippedIcon sx={{ color: colors.textSubtle, ...sx }} />;
        default:
            return <PendingIcon sx={{ color: colors.textSubtle, ...sx }} />;
    }
}

function isActivePhase(phase: string): boolean {
    return phase !== 'idle' && phase !== 'done' && phase !== 'failed' && phase !== 'rolled_back';
}

function phaseColorFor(phase: string): string {
    if (phase === 'done') return colors.statusSuccess;
    if (phase === 'failed' || phase === 'rolled_back') return colors.statusErrorAlt;
    if (phase === 'rolling_back') return colors.statusWarning;
    if (phase === 'idle') return colors.textWhite;
    return colors.statusInfo;
}

// Left-border colour for a step's phase band: green while the old PCS still
// serves the apps, amber through the switchover downtime window, blue once the
// new PCS serves them. See MIGRATION_STEP_PHASES in MigrationTypes.ts.
function phaseGroupColor(phase: MigrationStepPhase): string {
    switch (phase) {
        case 'source': return colors.statusSuccess;
        case 'switchover': return colors.statusWarning;
        case 'target': return colors.statusInfo;
    }
}

// Colour key for the per-step phase bands, shown above the step list. Each
// entry's tooltip carries the longer explanation from MIGRATION_STEP_PHASES.
const PhaseLegend: React.FC = () => (
    <Stack direction="row" spacing={2} flexWrap="wrap" sx={{ rowGap: 0.5 }}>
        {(Object.keys(MIGRATION_STEP_PHASES) as MigrationStepPhase[]).map(p => (
            <Tooltip key={p} title={MIGRATION_STEP_PHASES[p].description}>
                <Stack direction="row" spacing={0.75} alignItems="center" sx={{ cursor: 'help' }}>
                    <Box sx={{
                        width: 10,
                        height: 10,
                        borderRadius: '2px',
                        backgroundColor: phaseGroupColor(p),
                        flexShrink: 0,
                    }} />
                    <Typography sx={text.detail}>{MIGRATION_STEP_PHASES[p].label}</Typography>
                </Stack>
            </Tooltip>
        ))}
    </Stack>
);

// One-line, user-facing description of what each pipeline step does. Keyed by
// the step `key` in MIGRATION_STEPS. Sourced from the step table in
// doc/architecture/migration.md — keep in sync if the pipeline changes.
const STEP_DESCRIPTIONS: Record<string, string> = {
    preflight:
        "Checks the destination is reachable over SSH, has enough free disk, has a clean /DATA, and that both clocks agree. Nothing is changed yet.",
    push_key:
        "Generates a one-time SSH key and installs it on the destination's migration account using the password you entered. The password is used once, then discarded.",
    online_rsync:
        "Copies /DATA to the destination over SSH while your apps keep running. This is the longest step — it scales with how much data you have.",
    docker_pull:
        "Pre-pulls every app's Docker image on the destination — installing Docker there first if it isn't present — so the switchover doesn't wait on downloads.",
    stop_source:
        "Stops this PCS' apps and pauses its self-check so the data stops changing. The brief downtime window starts here.",
    offline_rsync:
        "A second, fast rsync pass that copies only what changed since the online copy and removes files deleted on this PCS.",
    target_self_check:
        "Runs the destination's self-check: installs Docker, detects its public IP, refreshes the PCS identity, and brings up the system stack.",
    start_user_apps:
        "Starts every app on the destination. An app whose image can no longer be pulled is reported but does not fail the migration.",
    deregister_source:
        "Stops this PCS' mesh-router so the destination takes over the domain uncontested. This is the cutover.",
    verify_destination:
        "Confirms the destination is healthy and that the domain now resolves to it. If either check fails, the migration rolls back.",
    cleanup:
        "Removes the temporary migration SSH key from the destination.",
    source_down:
        "Schedules this PCS' admin container to shut down shortly after the migration finishes reporting.",
    webhook:
        "Sends the final status to the orchestrator, which promotes the destination and retires this PCS. Skipped when no orchestrator is configured.",
};

// Always-visible reference at the bottom of the panel: the full step list with
// a plain-language description of each, grouped by the same phase colour bands
// the live status card uses. Unlike MigrationStatusCard this renders before any
// migration has run, so a user can read what will happen up front.
const MigrationStepsReferenceCard: React.FC = () => (
    <Card sx={card.root}>
        <Box sx={card.header}>
            <Typography sx={title.small}>Migration steps explained</Typography>
        </Box>
        <CardContent sx={card.content}>
            <Stack sx={{ gap: spacing.itemGap }}>
                <Typography sx={text.bodyMuted}>
                    The pipeline runs on this PCS (the source) and pushes your data to the
                    destination. The colour band on each step shows whether your apps are
                    online while it runs.
                </Typography>
                <PhaseLegend />
                {MIGRATION_STEPS.map(({ key, label, phase }, i) => (
                    <Box key={key} sx={{
                        display: 'flex',
                        flexDirection: 'row',
                        alignItems: 'flex-start',
                        borderLeft: `3px solid ${phaseGroupColor(phase)}`,
                        pl: 1,
                    }}>
                        <Typography sx={{ ...text.label, minWidth: 22, opacity: 0.6 }}>
                            {i + 1}
                        </Typography>
                        <Box>
                            <Typography sx={text.label}>{label}</Typography>
                            <Typography sx={text.detail}>{STEP_DESCRIPTIONS[key] ?? ''}</Typography>
                        </Box>
                    </Box>
                ))}
            </Stack>
        </CardContent>
    </Card>
);

function formatBytes(n: number): string {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    let v = n;
    while (v >= 1024 && i < units.length - 1) {
        v /= 1024;
        i++;
    }
    return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

// Outlined chip with semantic color — used in card headers (blue bg, so the
// color must come through on both border and label).
function statusChipSx(c: string) {
    return {
        ...chipStyle.tag,
        color: `${c} !important`,
        border: `1px solid ${c} !important`,
        '& .MuiChip-label': { color: `${c} !important` },
    };
}

// Outlined-button style for secondary actions in card content (white-on-card).
const outlineButton = {
    fontSize: font.label,
    fontWeight: 700,
    padding: '12px 30px',
    borderRadius: '30px',
    textTransform: 'none' as const,
    color: colors.textWhite,
    borderColor: colors.textWhite,
    '&:hover': {
        borderColor: colors.textWhite,
        backgroundColor: 'rgba(255, 255, 255, 0.08)',
    },
    '&.Mui-disabled': {
        color: 'rgba(255, 255, 255, 0.4)',
        borderColor: 'rgba(255, 255, 255, 0.3)',
    },
};

const dangerButton = {
    ...outlineButton,
    color: colors.statusErrorAlt,
    borderColor: colors.statusErrorAlt,
    '&:hover': {
        borderColor: colors.statusErrorAlt,
        backgroundColor: 'rgba(244, 67, 54, 0.08)',
    },
};

const MigrationIntroCard: React.FC = () => {
    const {brand} = useBrand();
    return (
    <Card sx={card.root}>
        <Box sx={card.header}>
            <Typography sx={title.small}>What is migration?</Typography>
        </Box>
        <CardContent sx={card.content}>
            <Stack spacing={1.5}>
                <Typography sx={text.bodyWhite}>
                    Migration moves a {brand.name} PCS — its domain, apps, and data — onto another machine.
                    The <strong>source</strong> (the PCS being moved) does all the work; the{' '}
                    <strong>destination</strong> only needs SSH and a sudoer account named{' '}
                    <Box component="code" sx={inlineCode}>migration</Box>. A bare Ubuntu host is
                    enough — Docker is installed automatically during the migration.
                </Typography>
                <Typography sx={text.bodyWhite}>How it works:</Typography>
                <Box component="ol" sx={{
                    margin: 0,
                    paddingLeft: '24px',
                    color: colors.textWhite,
                    '& li': { marginBottom: '8px', fontSize: font.label },
                }}>
                    <li>
                        On the <strong>destination</strong> (new PCS): open <em>Migrate INTO this PCS</em>{' '}
                        below → <em>Enable</em>. This creates the temporary <code>migration</code> sudoer
                        and shows its credentials.
                    </li>
                    <li>
                        Click <em>Open source migration panel</em> in that dialog (after entering the
                        source PCS URL) — you land back on the source with the destination&apos;s host
                        and user pre-filled.
                    </li>
                    <li>
                        On the <strong>source</strong> (this PCS, has your data): paste the destination
                        password into <em>Migrate OUT of this PCS</em>, hit <em>Test connection</em>,
                        then <em>Start migration</em>.
                    </li>
                    <li>
                        The source pushes /DATA over SSH (online sync), pre-pulls images on the
                        destination, stops its own apps, runs an offline diff, then triggers the
                        destination&apos;s self-check. The destination becomes the live PCS.
                    </li>
                    <li>
                        Once you&apos;ve verified the destination works, disable the migration account
                        from there.
                    </li>
                </Box>
            </Stack>
        </CardContent>
    </Card>
    );
};

type AccountState = 'absent' | 'enabled' | 'unknown';

interface DestinationCredentials {
    host: string;
    user: string;
    password: string;
}

const MigrationSourceAccount: React.FC = () => {
    const notify = useNotify();
    const [state, setState] = useState<AccountState>('unknown');
    const [busy, setBusy] = useState(false);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [destUrl, setDestUrl] = useState('');
    const [credentials, setCredentials] = useState<DestinationCredentials | null>(null);
    const [error, setError] = useState<string | null>(null);

    const refresh = async () => {
        try {
            const r = await apiRequest<{ state: AccountState }>(
                '/api/admin/migration/account-state',
                'GET'
            );
            setState(r.state === 'enabled' ? 'enabled' : 'absent');
        } catch {
            setState('unknown');
        }
    };

    useEffect(() => {
        refresh();
    }, []);

    const handleEnable = async () => {
        setError(null);
        setBusy(true);
        try {
            const r = await apiRequest<DestinationCredentials>(
                '/api/admin/migration/account-enable',
                'POST'
            );
            setCredentials(r);
            setState('enabled');
            notify('Migration account enabled', { type: 'success' });
        } catch (err: any) {
            setError(err?.message || 'Failed to enable migration account');
        } finally {
            setBusy(false);
        }
    };

    const handleDisable = async () => {
        if (!window.confirm('Disable the migration account on THIS PCS? The user will be deleted.')) return;
        setBusy(true);
        try {
            await apiRequest('/api/admin/migration/account-disable', 'POST');
            setState('absent');
            setCredentials(null);
            notify('Migration account disabled', { type: 'success' });
        } catch (err: any) {
            notify(err?.message || 'Failed to disable migration account', { type: 'error' });
        } finally {
            setBusy(false);
        }
    };

    const closeDialog = () => {
        setDialogOpen(false);
        setCredentials(null);
        setError(null);
        setDestUrl('');
    };

    const copy = (label: string, value: string) => {
        navigator.clipboard.writeText(value).then(
            () => notify(`${label} copied`, { type: 'info' }),
            () => notify(`Copy failed`, { type: 'warning' })
        );
    };

    // Build a link back to the SOURCE PCS' migration panel with this
    // (destination's) credentials prefilled in the "Migrate OUT" form.
    const sourceLink = (() => {
        if (!destUrl.trim() || !credentials) return null;
        let base = destUrl.trim();
        if (!/^https?:\/\//i.test(base)) base = 'https://' + base;
        try {
            const u = new URL(base);
            return `${u.origin}/#/migration?ip=${encodeURIComponent(credentials.host)}&user=${encodeURIComponent(credentials.user)}`;
        } catch {
            return null;
        }
    })();

    const chipLabel =
        state === 'unknown' ? 'CHECKING…' :
        state === 'enabled' ? 'ENABLED' :
        'ABSENT';
    const chipColor =
        state === 'enabled' ? colors.statusSuccess :
        state === 'unknown' ? colors.textWhite :
        colors.textWhite;

    return (
        <>
            <Card sx={card.root}>
                <Box sx={card.header}>
                    <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={2}>
                        <Typography sx={title.small}>Migrate INTO this PCS</Typography>
                        <Stack direction="row" alignItems="center" spacing={1.5}>
                            <Chip
                                label={chipLabel}
                                variant="outlined"
                                size="small"
                                sx={statusChipSx(chipColor)}
                            />
                            {state === 'enabled' ? (
                                <Button
                                    variant="outlined"
                                    onClick={handleDisable}
                                    disabled={busy}
                                    sx={{
                                        ...dangerButton,
                                        padding: '6px 18px',
                                        fontSize: font.detail,
                                    }}
                                >
                                    Disable
                                </Button>
                            ) : (
                                <Button
                                    onClick={() => setDialogOpen(true)}
                                    disabled={busy || state === 'unknown'}
                                    sx={{
                                        ...button.primary,
                                        padding: '6px 18px',
                                        fontSize: font.detail,
                                    }}
                                >
                                    Enable
                                </Button>
                            )}
                        </Stack>
                    </Stack>
                </Box>
                <CardContent sx={card.content}>
                    <Typography sx={text.bodyWhite}>
                        Use this when this PCS is the destination of a migration — i.e. another PCS
                        will push its data here. Enable creates a temporary sudoer account named{' '}
                        <Box component="code" sx={inlineCode}>migration</Box> with a random password,
                        which the source PCS uses to SSH and rsync into here. Disable it once the
                        migration is complete.
                    </Typography>
                </CardContent>
            </Card>

            <Dialog open={dialogOpen} onClose={busy ? undefined : closeDialog} maxWidth="sm" fullWidth>
                {!credentials ? (
                    <>
                        <DialogTitle>Enable migration into this PCS</DialogTitle>
                        <DialogContent>
                            <Stack spacing={2} sx={{ mt: 1 }}>
                                <Alert severity="warning">
                                    This PCS will become the destination of a migration. Once the
                                    source finishes pushing its data here, this PCS&apos; current
                                    data will be replaced by the source&apos;s data. Nothing is
                                    wiped right now — this step only creates a temporary sudoer
                                    account so the source can SSH in.
                                </Alert>
                                <Typography sx={text.bodyMuted}>
                                    A sudoer account named <Box component="code" sx={inlineCode}>migration</Box>{' '}
                                    will be created with a randomly generated password. Then jump to
                                    the source PCS&apos; migration panel via the link in the next step.
                                </Typography>
                                <TextField
                                    label="Source PCS admin URL (optional)"
                                    value={destUrl}
                                    onChange={e => setDestUrl(e.target.value)}
                                    placeholder="https://other-pcs.example.com"
                                    helperText="If provided, you'll get a one-click link to the source's migration panel — with this PCS' host and user pre-filled."
                                    fullWidth
                                    size="small"
                                />
                                {error && <Alert severity="error">{error}</Alert>}
                            </Stack>
                        </DialogContent>
                        <DialogActions>
                            <Button onClick={closeDialog} disabled={busy} sx={outlineButton}>
                                Cancel
                            </Button>
                            <Button
                                onClick={handleEnable}
                                disabled={busy}
                                startIcon={busy ? <CircularProgress size={16} /> : undefined}
                                sx={button.primary}
                            >
                                Enable
                            </Button>
                        </DialogActions>
                    </>
                ) : (
                    <>
                        <DialogTitle>Destination credentials</DialogTitle>
                        <DialogContent>
                            <Stack spacing={2} sx={{ mt: 1 }}>
                                <Alert severity="info">
                                    Paste these into the source PCS&apos; <em>Migrate OUT of this PCS</em> form
                                    (or use the link below to open it pre-filled). The password is shown only
                                    once — disable then re-enable to generate a new one.
                                </Alert>
                                <CopyableField label="Host / IP" value={credentials.host} onCopy={copy} />
                                <CopyableField label="User" value={credentials.user} onCopy={copy} />
                                <CopyableField label="Password" value={credentials.password} onCopy={copy} mono />
                                {sourceLink && (
                                    <Button
                                        startIcon={<OpenInNewIcon />}
                                        href={sourceLink}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        sx={button.primary}
                                    >
                                        Open source migration panel
                                    </Button>
                                )}
                            </Stack>
                        </DialogContent>
                        <DialogActions>
                            <Button onClick={closeDialog} sx={button.primary}>Done</Button>
                        </DialogActions>
                    </>
                )}
            </Dialog>
        </>
    );
};

const inlineCode = {
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
    padding: '1px 6px',
    borderRadius: '4px',
    fontFamily: 'monospace',
    fontSize: font.detail,
};

const CopyableField: React.FC<{
    label: string;
    value: string;
    onCopy: (label: string, value: string) => void;
    mono?: boolean;
}> = ({ label, value, onCopy, mono }) => (
    <TextField
        label={label}
        value={value}
        InputProps={{
            readOnly: true,
            sx: mono ? { fontFamily: 'monospace' } : undefined,
            endAdornment: (
                <IconButton size="small" onClick={() => onCopy(label, value)} edge="end">
                    <ContentCopyIcon fontSize="small" />
                </IconButton>
            ),
        }}
        fullWidth
        size="small"
    />
);
