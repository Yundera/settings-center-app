import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Alert,
    Box,
    Button,
    Card,
    CardContent,
    Chip,
    CircularProgress,
    Collapse,
    Dialog,
    DialogActions,
    DialogContent,
    DialogContentText,
    DialogTitle,
    FormControlLabel,
    IconButton,
    LinearProgress,
    Stack,
    Switch,
    Typography,
} from '@mui/material';
import {
    ExpandMore as ExpandMoreIcon,
    Refresh as RefreshIcon,
} from '@mui/icons-material';
import { useNotify } from 'react-admin';
import { apiRequest } from '@/core/authApi';
import {
    button,
    card,
    chip as chipStyle,
    colors,
    font,
    spacing,
    text,
    title,
} from '@/app/pages/softTheme';
import {
    AppAction,
    AppActionRequest,
    AppActionState,
    AppBackup,
    AppRow,
    AppState,
    AppsListResult,
    IssueRow,
} from '@/backend/server/Apps/AppsTypes';

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function formatBytes(n?: number): string {
    if (n === undefined || n === null) return '—';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    let v = n;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatBackupTimestamp(ts: string): string {
    // "20260420T175007" → "2026-04-20 17:50:07"
    const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/.exec(ts);
    if (!m) return ts;
    return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}`;
}

function stateLabel(s: AppState): string {
    switch (s) {
        case 'live': return 'LIVE';
        case 'down': return 'DOWN';
        case 'backup-only': return 'BACKUP';
        case 'backup-and-data': return 'BACKUP + DATA';
        case 'orphan-data': return 'DATA ONLY';
        case 'broken': return 'BROKEN';
        case 'empty-folder': return 'EMPTY';
    }
}

function stateColor(s: AppState): string {
    switch (s) {
        case 'live': return colors.statusSuccess;
        case 'down': return colors.textSubtle;
        case 'backup-only':
        case 'backup-and-data': return colors.statusInfo;
        case 'orphan-data': return colors.statusWarning;
        case 'broken':
        case 'empty-folder': return colors.statusErrorAlt;
    }
}

function statusChipSx(c: string) {
    return {
        ...chipStyle.tag,
        color: `${c} !important`,
        border: `1px solid ${c} !important`,
        '& .MuiChip-label': { color: `${c} !important` },
    };
}

const outlineButton = {
    fontSize: font.detail,
    fontWeight: 700,
    padding: '6px 16px',
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

const primaryButtonSmall = {
    ...button.primary,
    fontSize: font.detail,
    padding: '6px 18px',
};

// --------------------------------------------------------------------------
// Confirm dialog
// --------------------------------------------------------------------------

interface PendingConfirm {
    title: string;
    body: React.ReactNode;
    danger?: boolean;
    optionalSwitch?: { label: string; defaultOn: boolean };
    onConfirm: (optionalSwitchValue: boolean) => void;
}

const ConfirmDialog: React.FC<{
    pending: PendingConfirm | null;
    onClose: () => void;
}> = ({ pending, onClose }) => {
    const [optionalOn, setOptionalOn] = useState(false);
    useEffect(() => {
        setOptionalOn(pending?.optionalSwitch?.defaultOn ?? false);
    }, [pending]);

    if (!pending) return null;
    return (
        <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle>{pending.title}</DialogTitle>
            <DialogContent>
                <DialogContentText component="div" sx={{ color: colors.textMuted }}>
                    {pending.body}
                </DialogContentText>
                {pending.optionalSwitch && (
                    <FormControlLabel
                        sx={{ mt: 2, color: colors.textWhite }}
                        control={
                            <Switch
                                checked={optionalOn}
                                onChange={(_, v) => setOptionalOn(v)}
                            />
                        }
                        label={pending.optionalSwitch.label}
                    />
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose} sx={outlineButton}>Cancel</Button>
                <Button
                    onClick={() => { pending.onConfirm(optionalOn); onClose(); }}
                    sx={pending.danger ? dangerButton : button.primary}
                >
                    Confirm
                </Button>
            </DialogActions>
        </Dialog>
    );
};

// --------------------------------------------------------------------------
// Main panel
// --------------------------------------------------------------------------

export const AppsPanel: React.FC = () => {
    const notify = useNotify();
    const [data, setData] = useState<AppsListResult | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);

    // Per-app action state, polled while running.
    const [actionStates, setActionStates] = useState<Record<string, AppActionState | null>>({});
    const pollingApps = useRef<Set<string>>(new Set());

    const refresh = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const r = await apiRequest<AppsListResult>('/api/admin/apps/list', 'GET');
            setData(r);
        } catch (err: any) {
            setError(err?.message || 'Failed to load apps');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { refresh(); }, [refresh]);

    // Polling for any running action
    useEffect(() => {
        const interval = setInterval(async () => {
            const apps = Array.from(pollingApps.current);
            if (apps.length === 0) return;
            for (const app of apps) {
                try {
                    const s = await apiRequest<AppActionState | null>(
                        `/api/admin/apps/action-status?app=${encodeURIComponent(app)}`,
                        'GET',
                    );
                    setActionStates(prev => ({ ...prev, [app]: s }));
                    if (s && s.state !== 'running') {
                        pollingApps.current.delete(app);
                        if (s.state === 'done') {
                            notify(`${app}: ${s.action} completed`, { type: 'success' });
                        } else if (s.state === 'failed') {
                            notify(`${app}: ${s.action} failed`, { type: 'error' });
                        }
                        // Refresh snapshot after any action settles
                        refresh();
                    }
                } catch {
                    // transient; keep polling
                }
            }
        }, 2000);
        return () => clearInterval(interval);
    }, [notify, refresh]);

    const runAction = useCallback(async (req: AppActionRequest) => {
        try {
            const s = await apiRequest<AppActionState>(
                '/api/admin/apps/action',
                'POST',
                req,
            );
            setActionStates(prev => ({ ...prev, [req.app]: s }));
            pollingApps.current.add(req.app);
            notify(`${req.app}: ${req.action} started`, { type: 'info' });
        } catch (err: any) {
            notify(err?.message || 'Failed to start action', { type: 'error' });
        }
    }, [notify]);

    const summary = useMemo(() => {
        if (!data) return { live: 0, down: 0, backups: 0, issues: 0 };
        const live = data.apps.filter(a => a.state === 'live').length;
        const down = data.apps.filter(a => a.state === 'down').length;
        const backups = data.apps.reduce((acc, a) => acc + a.backups.length, 0);
        const issues = data.issues.length
            + data.apps.filter(a => a.state === 'broken' || a.state === 'empty-folder').length;
        return { live, down, backups, issues };
    }, [data]);

    return (
        <Box sx={{
            paddingTop: spacing.pageY,
            paddingBottom: spacing.pageY,
            paddingX: spacing.pageX,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
        }}>
            <Typography sx={{ ...title.large, textAlign: 'center', marginBottom: '15px' }}>
                Apps
            </Typography>
            <Typography sx={{
                ...text.detail,
                textAlign: 'center',
                maxWidth: '800px',
                marginBottom: '30px',
            }}>
                Inspect every installed app, every data folder, and every backup zip
                under <Box component="code" sx={inlineCode}>/DATA/AppData</Box> — and
                bring them up, down, backed up, or restored without leaving this page.
            </Typography>

            {error && (
                <Alert severity="error" sx={{ mb: 2, maxWidth: '900px', width: '100%' }}>
                    {error}
                </Alert>
            )}

            <Box sx={{
                display: 'flex',
                flexDirection: 'column',
                gap: spacing.cardGap,
                maxWidth: '900px',
                width: '100%',
            }}>
                {/* Summary */}
                <Card sx={card.root}>
                    <Box sx={card.header}>
                        <Stack direction="row" alignItems="center" justifyContent="space-between">
                            <Typography sx={title.small}>Summary</Typography>
                            <Button
                                onClick={refresh}
                                startIcon={loading ? <CircularProgress size={14} /> : <RefreshIcon />}
                                disabled={loading}
                                sx={outlineButton}
                            >
                                Refresh
                            </Button>
                        </Stack>
                    </Box>
                    <CardContent sx={card.content}>
                        <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
                            <Chip label={`${summary.live} live`} sx={statusChipSx(colors.statusSuccess)} variant="outlined" />
                            <Chip label={`${summary.down} down`} sx={statusChipSx(colors.textSubtle)} variant="outlined" />
                            <Chip label={`${summary.backups} backups`} sx={statusChipSx(colors.statusInfo)} variant="outlined" />
                            <Chip label={`${summary.issues} issues`} sx={statusChipSx(summary.issues ? colors.statusErrorAlt : colors.textSubtle)} variant="outlined" />
                            {data && (
                                <Chip
                                    label={`disk: ${formatBytes(data.disk.free)} free / ${formatBytes(data.disk.total)}`}
                                    sx={statusChipSx(colors.textWhite)}
                                    variant="outlined"
                                />
                            )}
                        </Stack>
                    </CardContent>
                </Card>

                {/* Apps */}
                {data && data.apps.length > 0 && (
                    <Card sx={card.root}>
                        <Box sx={card.header}>
                            <Typography sx={title.small}>Apps</Typography>
                        </Box>
                        <CardContent sx={card.content}>
                            <Stack spacing={1.5}>
                                {data.apps.map(app => (
                                    <AppRowView
                                        key={app.name}
                                        app={app}
                                        actionState={actionStates[app.name] ?? null}
                                        setPendingConfirm={setPendingConfirm}
                                        runAction={runAction}
                                    />
                                ))}
                            </Stack>
                        </CardContent>
                    </Card>
                )}

                {/* Issues */}
                {data && data.issues.length > 0 && (
                    <Card sx={card.root}>
                        <Box sx={card.header}>
                            <Typography sx={title.small}>Issues ({data.issues.length})</Typography>
                        </Box>
                        <CardContent sx={card.content}>
                            <Stack spacing={1.5}>
                                {data.issues.map(issue => (
                                    <IssueRowView
                                        key={issue.name}
                                        issue={issue}
                                        setPendingConfirm={setPendingConfirm}
                                        runAction={runAction}
                                    />
                                ))}
                            </Stack>
                        </CardContent>
                    </Card>
                )}
            </Box>

            <ConfirmDialog pending={pendingConfirm} onClose={() => setPendingConfirm(null)} />
        </Box>
    );
};

// --------------------------------------------------------------------------
// Per-app row
// --------------------------------------------------------------------------

const AppRowView: React.FC<{
    app: AppRow;
    actionState: AppActionState | null;
    setPendingConfirm: (p: PendingConfirm) => void;
    runAction: (req: AppActionRequest) => void;
}> = ({ app, actionState, setPendingConfirm, runAction }) => {
    const [expanded, setExpanded] = useState(false);
    const running = actionState?.state === 'running';

    const confirm = (
        title: string,
        body: React.ReactNode,
        req: AppActionRequest,
        opts?: { danger?: boolean; optionalSwitch?: { label: string; defaultOn: boolean; field: 'alsoDeleteData' } },
    ) => {
        setPendingConfirm({
            title,
            body,
            danger: opts?.danger,
            optionalSwitch: opts?.optionalSwitch,
            onConfirm: (optVal) => {
                const finalReq = opts?.optionalSwitch
                    ? { ...req, [opts.optionalSwitch.field]: optVal }
                    : req;
                runAction(finalReq);
            },
        });
    };

    const buttons = renderButtons(app, confirm, runAction, running);

    const totalBackupSize = app.backups.reduce((a, b) => a + b.size, 0);

    return (
        <Box sx={{
            border: `1px solid ${colors.borderMuted}`,
            borderRadius: '8px',
            padding: '12px 16px',
        }}>
            <Stack direction="row" alignItems="center" spacing={2} sx={{ flexWrap: 'wrap', gap: 1 }}>
                <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                    <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 0.5 }}>
                        <Typography sx={{ ...text.label, fontFamily: 'monospace' }}>{app.name}</Typography>
                        <Chip
                            label={stateLabel(app.state)}
                            size="small"
                            variant="outlined"
                            sx={statusChipSx(stateColor(app.state))}
                        />
                    </Stack>
                    <Typography sx={text.detail}>
                        {app.dataSize !== undefined && `data ${formatBytes(app.dataSize)} · `}
                        {app.backups.length > 0
                            ? `${app.backups.length} backup${app.backups.length === 1 ? '' : 's'} (${formatBytes(totalBackupSize)})`
                            : 'no backups'}
                        {app.error && ` · ${app.error}`}
                    </Typography>
                </Box>
                <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap', gap: 1 }}>
                    {buttons}
                    <IconButton
                        size="small"
                        onClick={() => setExpanded(e => !e)}
                        sx={{
                            color: colors.textWhite,
                            transform: expanded ? 'rotate(180deg)' : 'none',
                            transition: 'transform 0.2s',
                        }}
                    >
                        <ExpandMoreIcon />
                    </IconButton>
                </Stack>
            </Stack>

            {running && (
                <Box sx={{ mt: 1.5 }}>
                    <Typography sx={text.detail}>
                        {actionState!.action} in progress…
                    </Typography>
                    <LinearProgress sx={{ mt: 0.5 }} />
                </Box>
            )}

            <Collapse in={expanded} unmountOnExit>
                <Box sx={{ mt: 2 }}>
                    <Stack spacing={1}>
                        {app.composePath && (
                            <Typography sx={text.detail}>
                                Compose: <Box component="code" sx={inlineCode}>{app.composePath}</Box>
                            </Typography>
                        )}
                        {app.dataPath && (
                            <Typography sx={text.detail}>
                                Data: <Box component="code" sx={inlineCode}>{app.dataPath}</Box>
                            </Typography>
                        )}

                        {app.backups.length > 0 && (
                            <Box>
                                <Typography sx={{ ...text.label, mt: 1, mb: 0.5 }}>Backups</Typography>
                                <Stack spacing={0.75}>
                                    {app.backups.map(b => (
                                        <BackupRowView
                                            key={b.filename}
                                            app={app}
                                            backup={b}
                                            disabled={running}
                                            confirm={confirm}
                                        />
                                    ))}
                                </Stack>
                            </Box>
                        )}

                        {actionState && (
                            <Box sx={{ mt: 1 }}>
                                <Typography sx={{ ...text.label, mb: 0.5 }}>
                                    Last action: {actionState.action} — {actionState.state}
                                </Typography>
                                {actionState.error && (
                                    <Alert severity="error" sx={{ mb: 1 }}>{actionState.error}</Alert>
                                )}
                                <Box component="pre" sx={logSx}>
                                    {actionState.output || '(no output)'}
                                </Box>
                            </Box>
                        )}
                    </Stack>
                </Box>
            </Collapse>
        </Box>
    );
};

// --------------------------------------------------------------------------
// Per-backup row (inside expanded app)
// --------------------------------------------------------------------------

const BackupRowView: React.FC<{
    app: AppRow;
    backup: AppBackup;
    disabled: boolean;
    confirm: (title: string, body: React.ReactNode, req: AppActionRequest, opts?: any) => void;
}> = ({ app, backup, disabled, confirm }) => {
    const hasData = !!app.dataPath;
    const canUp = app.installed && !app.running;
    return (
        <Stack direction="row" alignItems="center" spacing={1.5} sx={{ flexWrap: 'wrap', gap: 1 }}>
            <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                <Typography sx={{ ...text.detail, fontFamily: 'monospace' }}>
                    {backup.filename}
                </Typography>
                <Typography sx={text.detail}>
                    {formatBackupTimestamp(backup.timestamp)} · {formatBytes(backup.size)}
                </Typography>
            </Box>
            <Button
                disabled={disabled}
                onClick={() => confirm(
                    `Restore ${app.name}?`,
                    <>
                        Restore <code>{app.name}</code> from <code>{backup.filename}</code>.
                        {hasData && (
                            <> Current data at <code>{app.dataPath}</code> will be backed up first, then replaced.</>
                        )}
                        {canUp && <> The app will be brought up after restore.</>}
                    </>,
                    { app: app.name, action: canUp ? 'restore-and-up' : 'restore', backup: backup.filename },
                )}
                sx={primaryButtonSmall}
            >
                Restore
            </Button>
            <Button
                disabled={disabled}
                onClick={() => confirm(
                    `Delete backup?`,
                    <>Delete <code>{backup.filename}</code> ({formatBytes(backup.size)}). This cannot be undone.</>,
                    { app: app.name, action: 'delete-backup', backup: backup.filename },
                    { danger: true },
                )}
                sx={dangerButton}
            >
                Delete
            </Button>
        </Stack>
    );
};

// --------------------------------------------------------------------------
// Issue row (stray files)
// --------------------------------------------------------------------------

const IssueRowView: React.FC<{
    issue: IssueRow;
    setPendingConfirm: (p: PendingConfirm) => void;
    runAction: (req: AppActionRequest) => void;
}> = ({ issue, setPendingConfirm, runAction }) => (
    <Stack direction="row" alignItems="center" spacing={2} sx={{ flexWrap: 'wrap', gap: 1 }}>
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
            <Typography sx={{ ...text.label, fontFamily: 'monospace' }}>{issue.name}</Typography>
            <Typography sx={text.detail}>
                Unrecognised file at <code>{issue.path}</code> · {formatBytes(issue.size)}
            </Typography>
        </Box>
        <Button
            onClick={() => setPendingConfirm({
                title: 'Delete file?',
                body: <>Delete <code>{issue.path}</code>. This cannot be undone.</>,
                danger: true,
                onConfirm: () => runAction({ app: issue.name, action: 'delete-stray' }),
            })}
            sx={dangerButton}
        >
            Delete
        </Button>
    </Stack>
);

// --------------------------------------------------------------------------
// Buttons-per-state matrix
// --------------------------------------------------------------------------

function renderButtons(
    app: AppRow,
    confirm: (title: string, body: React.ReactNode, req: AppActionRequest, opts?: any) => void,
    runAction: (req: AppActionRequest) => void,
    disabled: boolean,
): React.ReactNode {
    const composeReq = (action: AppAction): AppActionRequest => ({ app: app.name, action });

    const btn = (label: string, onClick: () => void, sx: any) => (
        <Button key={label} disabled={disabled} onClick={onClick} sx={sx}>{label}</Button>
    );

    switch (app.state) {
        case 'live':
            return [
                btn('Down', () => confirm(
                    `Down ${app.name}?`,
                    <>Run <code>docker compose down --remove-orphans</code> on <code>{app.composePath}</code>.</>,
                    composeReq('down'),
                ), outlineButton),
                btn('Down & Backup', () => confirm(
                    `Down & Backup ${app.name}?`,
                    <>Stop the stack and zip <code>{app.dataPath ?? `/DATA/AppData/${app.name}`}</code> to a timestamped backup.</>,
                    composeReq('down-and-backup'),
                ), primaryButtonSmall),
            ];
        case 'down':
            return [
                btn('Up', () => runAction(composeReq('up')), primaryButtonSmall),
                btn('Backup', () => confirm(
                    `Backup ${app.name}?`,
                    <>Zip <code>{app.dataPath ?? `/DATA/AppData/${app.name}`}</code> to a timestamped backup. The app is already down so data is consistent.</>,
                    composeReq('backup'),
                ), outlineButton),
                btn('Uninstall', () => confirm(
                    `Uninstall ${app.name}?`,
                    <>
                        Remove <code>/DATA/AppData/casaos/apps/{app.name}/</code>. The app will disappear from CasaOS.
                        {app.dataPath && <> Toggle below to also delete <code>{app.dataPath}</code>.</>}
                    </>,
                    composeReq('uninstall'),
                    {
                        danger: true,
                        optionalSwitch: app.dataPath
                            ? { label: `Also delete data folder ${app.dataPath}`, defaultOn: false, field: 'alsoDeleteData' }
                            : undefined,
                    },
                ), dangerButton),
            ];
        case 'broken':
            return [
                btn('Delete install dir', () => confirm(
                    `Delete broken install of ${app.name}?`,
                    <>
                        Remove <code>/DATA/AppData/casaos/apps/{app.name}/</code> (compose file is missing/invalid).
                        {app.dataPath && <> Data folder <code>{app.dataPath}</code> is left alone.</>}
                    </>,
                    composeReq('uninstall'),
                    { danger: true },
                ), dangerButton),
            ];
        case 'backup-only':
            // No data, no install. Just restore the data — no 'up' since no compose.
            return app.backups.length > 0 ? [
                btn('Restore latest', () => confirm(
                    `Restore ${app.name} from latest backup?`,
                    <>Unzip <code>{app.backups[0].filename}</code> into <code>/DATA/AppData/</code>. App is not installed in CasaOS — you may need to reinstall it from the store afterwards.</>,
                    { app: app.name, action: 'restore', backup: app.backups[0].filename },
                ), primaryButtonSmall),
            ] : [];
        case 'backup-and-data':
            return [
                btn('Restore latest', () => confirm(
                    `Restore ${app.name} from latest backup?`,
                    <>
                        Current data at <code>{app.dataPath}</code> will be backed up first, then replaced
                        with <code>{app.backups[0].filename}</code>.
                    </>,
                    { app: app.name, action: 'restore', backup: app.backups[0].filename },
                ), primaryButtonSmall),
                btn('Delete data', () => confirm(
                    `Delete data folder?`,
                    <>Remove <code>{app.dataPath}</code> (backup zips are kept).</>,
                    composeReq('delete-data'),
                    { danger: true },
                ), dangerButton),
            ];
        case 'orphan-data':
            return [
                btn('Backup', () => confirm(
                    `Backup ${app.name}?`,
                    <>Zip <code>{app.dataPath}</code> to a timestamped backup before any cleanup.</>,
                    composeReq('backup'),
                ), outlineButton),
                btn('Delete data', () => confirm(
                    `Delete orphan data?`,
                    <>Remove <code>{app.dataPath}</code>. App is not installed in CasaOS.</>,
                    composeReq('delete-data'),
                    { danger: true },
                ), dangerButton),
            ];
        case 'empty-folder':
            return [
                btn('Delete folder', () => confirm(
                    `Delete empty folder?`,
                    <>Remove the empty folder <code>{app.dataPath}</code>.</>,
                    composeReq('delete-data'),
                    { danger: true },
                ), dangerButton),
            ];
    }
}

// --------------------------------------------------------------------------
// Shared styles
// --------------------------------------------------------------------------

const inlineCode = {
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
    padding: '1px 6px',
    borderRadius: '4px',
    fontFamily: 'monospace',
    fontSize: font.detail,
};

const logSx = {
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
    color: colors.textMuted,
    fontSize: font.caption,
    fontFamily: 'monospace',
    padding: '8px 12px',
    borderRadius: '4px',
    maxHeight: '240px',
    overflow: 'auto',
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-word' as const,
    margin: 0,
};
