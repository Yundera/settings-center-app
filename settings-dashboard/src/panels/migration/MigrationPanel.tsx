import React, { useState, useEffect, useRef } from 'react';
import {
    Alert,
    Box,
    Button,
    Card,
    CardContent,
    Chip,
    CircularProgress,
    LinearProgress,
    List,
    ListItem,
    ListItemIcon,
    ListItemText,
    Stack,
    TextField,
    Typography,
} from '@mui/material';
import {
    CheckCircle as CheckCircleIcon,
    Error as ErrorIcon,
    RadioButtonUnchecked as PendingIcon,
    Schedule as RunningIcon,
    RemoveCircle as SkippedIcon,
} from '@mui/icons-material';
import { PageContainer } from 'dashboard-core';
import { useNotify } from 'react-admin';
import { useSearchParams } from 'react-router-dom';
import { apiRequest } from '@/core/authApi';
import {
    MigrationStatus,
    MIGRATION_STEPS,
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
    // Prefill from query string: ?ip=...&user=...&webhook=...
    // (password is intentionally not accepted from the query — it would end up in
    // browser history, referrer headers, and server access logs)
    const [host, setHost] = useState(() => searchParams.get('ip') || searchParams.get('host') || '');
    const [user, setUser] = useState(() => searchParams.get('user') || '');
    const [password, setPassword] = useState('');
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
        <PageContainer>
            <div style={{ width: '60vw' }} />
            <Typography variant="h4" gutterBottom>
                Migration
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                Migrate a running PCS onto this freshly-provisioned one. This target becomes the source:
                same domain, same apps, same data. The source must remain powered off afterwards.
            </Typography>

            {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

            <Stack spacing={3}>
                <Card>
                    <CardContent>
                        <Stack spacing={2}>
                            <Typography variant="h6">Source PCS</Typography>
                            <TextField
                                label="Host or IP"
                                value={host}
                                onChange={e => setHost(e.target.value)}
                                disabled={phaseActive}
                                fullWidth
                                size="small"
                            />
                            <TextField
                                label="User (must have sudo)"
                                value={user}
                                onChange={e => setUser(e.target.value)}
                                disabled={phaseActive}
                                fullWidth
                                size="small"
                            />
                            <TextField
                                label="Password"
                                type="password"
                                value={password}
                                onChange={e => setPassword(e.target.value)}
                                disabled={phaseActive}
                                fullWidth
                                size="small"
                                helperText="Used once to install a temporary migration key. Never stored."
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
                                >
                                    Test connection
                                </Button>
                                <Button
                                    variant="contained"
                                    color="primary"
                                    onClick={handleStart}
                                    disabled={!canStart || starting}
                                    startIcon={starting ? <CircularProgress size={16} /> : undefined}
                                >
                                    Start migration
                                </Button>
                                {phaseActive && (
                                    <Button
                                        variant="outlined"
                                        color="warning"
                                        onClick={handleCancel}
                                        disabled={status.cancelRequested}
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
            </Stack>
        </PageContainer>
    );
};

const PreflightResultCard: React.FC<{ result: PreflightResult }> = ({ result }) => (
    <Card>
        <CardContent>
            <Stack spacing={2}>
                <Stack direction="row" alignItems="center" spacing={2}>
                    <Typography variant="h6">Preflight</Typography>
                    <Chip
                        label={result.ok ? 'OK' : 'FAILED'}
                        color={result.ok ? 'success' : 'error'}
                        variant="outlined"
                    />
                </Stack>
                <List dense>
                    {result.checks.map(c => (
                        <ListItem key={c.name}>
                            <ListItemIcon>
                                {c.ok ? <CheckCircleIcon color="success" /> : <ErrorIcon color="error" />}
                            </ListItemIcon>
                            <ListItemText primary={c.name} secondary={c.message} />
                        </ListItem>
                    ))}
                </List>
            </Stack>
        </CardContent>
    </Card>
);

const MigrationStatusCard: React.FC<{ status: MigrationStatus }> = ({ status }) => {
    const phaseLabel = status.phase.replace(/_/g, ' ').toUpperCase();
    const phaseColor = phaseColorFor(status.phase);

    return (
        <Card>
            <CardContent>
                <Stack spacing={2}>
                    <Stack direction="row" alignItems="center" spacing={2}>
                        <Typography variant="h6">Migration status</Typography>
                        <Chip label={phaseLabel} color={phaseColor} variant="outlined" />
                        {isActivePhase(status.phase) && (
                            <Box display="flex" alignItems="center" gap={1}>
                                <CircularProgress size={16} />
                                <Typography variant="body2" color="text.secondary">
                                    Running…
                                </Typography>
                            </Box>
                        )}
                    </Stack>

                    {status.error && <Alert severity="error">{status.error}</Alert>}

                    {status.rsync && (
                        <Box>
                            <Typography variant="body2" gutterBottom>
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

                    <List dense>
                        {MIGRATION_STEPS.map(({ key, label }) => {
                            const step = status.steps[key];
                            return (
                                <ListItem key={key}>
                                    <ListItemIcon>{stepIcon(step?.status)}</ListItemIcon>
                                    <ListItemText
                                        primary={label}
                                        secondary={step?.message || ''}
                                    />
                                </ListItem>
                            );
                        })}
                    </List>

                    {status.startedAt && (
                        <Typography variant="caption" color="text.secondary">
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
    switch (s) {
        case 'success':
            return <CheckCircleIcon color="success" />;
        case 'failed':
            return <ErrorIcon color="error" />;
        case 'running':
            return <RunningIcon color="info" />;
        case 'skipped':
            return <SkippedIcon color="disabled" />;
        default:
            return <PendingIcon color="disabled" />;
    }
}

function isActivePhase(phase: string): boolean {
    return phase !== 'idle' && phase !== 'done' && phase !== 'failed' && phase !== 'rolled_back';
}

function phaseColorFor(phase: string): 'default' | 'success' | 'error' | 'warning' | 'info' {
    if (phase === 'done') return 'success';
    if (phase === 'failed' || phase === 'rolled_back') return 'error';
    if (phase === 'rolling_back') return 'warning';
    if (phase === 'idle') return 'default';
    return 'info';
}

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
