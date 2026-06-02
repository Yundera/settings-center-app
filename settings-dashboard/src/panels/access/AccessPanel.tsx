import React, { useCallback, useEffect, useMemo, useState } from "react";
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
    DialogContentText,
    DialogTitle,
    Divider,
    FormControlLabel,
    IconButton,
    Stack,
    Switch,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableRow,
    TextField,
    ToggleButton,
    ToggleButtonGroup,
    Typography,
} from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DownloadIcon from "@mui/icons-material/Download";
import { useNotify } from "react-admin";
import { useSearchParams } from "react-router-dom";
import { apiRequest } from "@/core/authApi";
import { button, card, colors, font, spacing, text, title } from "@/app/pages/softTheme";
import { generateEd25519Key, isEd25519GenerationSupported, GeneratedKey } from "./sshKeygen";

const VALID_KEY_TYPE_RE = /^(ssh-(rsa|dss|ed25519)|ecdsa-sha2-nistp(256|384|521)|sk-(ssh-ed25519|ecdsa-sha2-nistp256)@openssh\.com)$/;

interface ParsedKey {
    type: string;
    b64: string;
    comment: string;
    full: string;
}

function parsePublicKey(raw: string | null): ParsedKey | null {
    if (typeof raw !== 'string') return null;
    const line = raw.replace(/\r/g, '').trim();
    if (!line || line.includes('\n')) return null;
    const parts = line.split(/\s+/);
    if (parts.length < 2) return null;
    const [type, b64, ...rest] = parts;
    if (!VALID_KEY_TYPE_RE.test(type)) return null;
    if (!/^[A-Za-z0-9+/=]+$/.test(b64)) return null;
    return { type, b64, comment: rest.join(' '), full: line };
}

async function computeFingerprint(b64: string): Promise<string | null> {
    try {
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const hash = await crypto.subtle.digest('SHA-256', bytes);
        const hashBytes = new Uint8Array(hash);
        let s = '';
        for (let i = 0; i < hashBytes.length; i++) s += String.fromCharCode(hashBytes[i]);
        return `SHA256:${btoa(s).replace(/=+$/, '')}`;
    } catch {
        return null;
    }
}

interface AuthorizedKey {
    type: string;
    fingerprint: string;
    bits: number | null;
    comment: string;
    isAdminKey: boolean;
    isLiveDashboardKey: boolean;
    isSupportKey: boolean;
    isUserKey: boolean;
}

interface LoginEvent {
    username: string;
    terminal: string;
    from: string;
    time: string;
    duration: string;
}

interface HostAccount {
    username: string;
    uid: number;
    gid: number;
    home: string;
    shell: string;
    isSystem: boolean;
    lastLoginTime: string | null;
    lastLoginFrom: string | null;
    authorizedKeys: AuthorizedKey[];
    authorizedKeysError: string | null;
}

interface AccessInfoResponse {
    accounts: HostAccount[];
    recentLogins: LoginEvent[];
    dashboardAccount: string;
    collectedAt: string;
}

const tableHeadCell = {
    color: colors.textMuted,
    fontSize: font.caption,
    fontWeight: 700,
    letterSpacing: '0.75px',
    textTransform: 'uppercase' as const,
    borderBottomColor: colors.borderMuted,
};

const tableBodyCell = {
    color: colors.textWhite,
    fontSize: font.detail,
    borderBottomColor: colors.borderMuted,
};

/**
 * AccessPanel — "Access" page. Lists Linux user accounts on the host, the
 * authorized SSH keys per account, and recent login history (time + IP).
 */
interface RemoveTarget {
    username: string;
    fingerprint: string;
    comment: string;
    // True when removing this key would leave zero `user-` keys across all
    // accounts — i.e. no personal way back into the PCS. Covers both removing
    // the last USER key and removing a support/unknown key when none exists.
    leavesNoUserKey: boolean;
}

export const AccessPanel: React.FC = () => {
    const notify = useNotify();
    const [searchParams, setSearchParams] = useSearchParams();
    const [data, setData] = useState<AccessInfoResponse | null>(null);
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);
    const [addKeyTarget, setAddKeyTarget] = useState<string | null>(null);
    const [removeTarget, setRemoveTarget] = useState<RemoveTarget | null>(null);
    const [deeplinkDismissed, setDeeplinkDismissed] = useState<boolean>(false);

    const deeplinkAccount = searchParams.get('account');
    const deeplinkPubkey = searchParams.get('pubkey');
    const deeplinkPubkeyUrl = searchParams.get('pubkeyUrl');
    const deeplinkActive = !deeplinkDismissed && (
        deeplinkAccount !== null || deeplinkPubkey !== null || deeplinkPubkeyUrl !== null
    );

    const clearDeeplink = useCallback(() => {
        setSearchParams(prev => {
            const next = new URLSearchParams(prev);
            next.delete('account');
            next.delete('pubkey');
            next.delete('pubkeyUrl');
            return next;
        }, { replace: true });
        setDeeplinkDismissed(true);
    }, [setSearchParams]);

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const res = await apiRequest<AccessInfoResponse>("/api/admin/access-info", "GET");
            setData(res);
            setError(null);
        } catch (err: any) {
            setError(err?.message || "Failed to load access info");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const loginAccounts = (data?.accounts || []).filter(a => !a.isSystem || a.authorizedKeys.length > 0 || a.lastLoginTime);
    const otherAccounts = (data?.accounts || []).filter(a => a.isSystem && a.authorizedKeys.length === 0 && !a.lastLoginTime);
    // Account the dashboard logs into; the admin key is delete-locked only here.
    const dashboardAccount = data?.dashboardAccount ?? 'admin';
    // How many human "user-" keys exist across every account — the access of
    // last resort. Drives the lockout warnings on key removal and on disabling
    // support access.
    const userKeyCount = useMemo(
        () => (data?.accounts || []).reduce(
            (n, a) => n + a.authorizedKeys.filter(k => k.isUserKey).length,
            0,
        ),
        [data],
    );

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
                Access
            </Typography>

            <Box sx={{
                display: 'flex',
                flexDirection: 'column',
                gap: spacing.cardGap,
                maxWidth: '1000px',
                width: '100%',
            }}>
                {deeplinkActive && (
                    <AuthorizeDeeplinkCard
                        requestedAccount={deeplinkAccount}
                        rawPubkey={deeplinkPubkey}
                        pubkeyUrl={deeplinkPubkeyUrl}
                        accounts={data?.accounts ?? null}
                        accountsLoaded={data !== null}
                        onDismiss={clearDeeplink}
                        onAdded={(status) => {
                            clearDeeplink();
                            fetchData();
                            notify(
                                status === 'already-present'
                                    ? 'Key was already authorized — nothing changed'
                                    : 'SSH key added',
                                { type: status === 'already-present' ? 'info' : 'success' },
                            );
                        }}
                    />
                )}

                <SupportEnsureCard onChanged={fetchData} userKeyCount={userKeyCount} />

                {/* Accounts and keys card */}
                <Card sx={card.root}>
                    <Box sx={card.header}>
                        <Stack direction="row" alignItems="center" justifyContent="space-between">
                            <Typography sx={title.small}>Host accounts &amp; SSH keys</Typography>
                            <Button
                                onClick={fetchData}
                                disabled={loading}
                                startIcon={loading ? <CircularProgress size={14} /> : <RefreshIcon />}
                                sx={button.primary}
                            >
                                Refresh
                            </Button>
                        </Stack>
                    </Box>
                    <CardContent sx={card.content}>
                        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

                        {loading && !data && (
                            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                                <CircularProgress />
                            </Box>
                        )}

                        {data && loginAccounts.length === 0 && (
                            <Typography sx={text.bodyMuted}>No login accounts detected.</Typography>
                        )}

                        <Stack sx={{ gap: spacing.itemGap }}>
                            {loginAccounts.map(account => (
                                <AccountBlock
                                    key={account.username}
                                    account={account}
                                    dashboardAccount={dashboardAccount}
                                    onAddKey={() => setAddKeyTarget(account.username)}
                                    onRemoveKey={(key) => setRemoveTarget({
                                        username: account.username,
                                        fingerprint: key.fingerprint,
                                        comment: key.comment,
                                        leavesNoUserKey: (userKeyCount - (key.isUserKey ? 1 : 0)) === 0,
                                    })}
                                />
                            ))}
                        </Stack>

                        {otherAccounts.length > 0 && (
                            <>
                                <Divider sx={{ my: 3, borderColor: colors.borderMuted }} />
                                <Typography sx={{ ...text.label, mb: 1 }}>
                                    Other system accounts ({otherAccounts.length})
                                </Typography>
                                <Typography sx={{ ...text.detail, mb: 2 }}>
                                    System users with no recorded login and no authorized keys.
                                </Typography>
                                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                                    {otherAccounts.map(a => (
                                        <Chip key={a.username} label={`${a.username} (${a.uid})`} size="small" />
                                    ))}
                                </Box>
                            </>
                        )}

                        {data && (
                            <Typography sx={{ ...text.detail, mt: 3 }}>
                                Collected at {new Date(data.collectedAt).toLocaleString()}
                            </Typography>
                        )}
                    </CardContent>
                </Card>

                {/* Recent logins card */}
                <Card sx={card.root}>
                    <Box sx={card.header}>
                        <Typography sx={title.small}>Recent login history</Typography>
                    </Box>
                    <CardContent sx={card.content}>
                        {data && data.recentLogins.length === 0 && (
                            <Typography sx={text.bodyMuted}>No login records found.</Typography>
                        )}
                        {data && data.recentLogins.length > 0 && (
                            <Box sx={{ overflowX: 'auto' }}>
                                <Table size="small">
                                    <TableHead>
                                        <TableRow>
                                            <TableCell sx={tableHeadCell}>User</TableCell>
                                            <TableCell sx={tableHeadCell}>Terminal</TableCell>
                                            <TableCell sx={tableHeadCell}>From</TableCell>
                                            <TableCell sx={tableHeadCell}>Time</TableCell>
                                            <TableCell sx={tableHeadCell}>Duration</TableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {data.recentLogins.map((event, idx) => (
                                            <TableRow key={idx}>
                                                <TableCell sx={tableBodyCell}>{event.username}</TableCell>
                                                <TableCell sx={tableBodyCell}>{event.terminal || '—'}</TableCell>
                                                <TableCell sx={tableBodyCell}>{event.from || '—'}</TableCell>
                                                <TableCell sx={tableBodyCell}>{event.time || '—'}</TableCell>
                                                <TableCell sx={tableBodyCell}>{event.duration || '—'}</TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </Box>
                        )}
                    </CardContent>
                </Card>
            </Box>

            <AddKeyDialog
                username={addKeyTarget}
                onClose={() => setAddKeyTarget(null)}
                onAdded={() => {
                    setAddKeyTarget(null);
                    fetchData();
                }}
            />

            <RemoveKeyDialog
                target={removeTarget}
                onClose={() => setRemoveTarget(null)}
                onRemoved={() => {
                    setRemoveTarget(null);
                    fetchData();
                }}
            />
        </Box>
    );
};

interface SupportEnsureStatus {
    ensure: boolean;
    accessEnabled: boolean;
    username: string;
    fingerprint: string;
    comment: string;
}

const SupportEnsureCard: React.FC<{ onChanged: () => void; userKeyCount: number }> = ({ onChanged, userKeyCount }) => {
    const notify = useNotify();
    const [status, setStatus] = useState<SupportEnsureStatus | null>(null);
    const [loading, setLoading] = useState<boolean>(true);
    const [toggling, setToggling] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    // Set when the user tries to disable support access while no `user-` key
    // exists — opens a lockout confirmation before we actually apply it.
    const [confirmDisable, setConfirmDisable] = useState<boolean>(false);

    const fetchStatus = useCallback(async () => {
        setLoading(true);
        try {
            const res = await apiRequest<SupportEnsureStatus>("/api/admin/support-ensure", "GET");
            setStatus(res);
            setError(null);
        } catch (err: any) {
            setError(err?.message || "Failed to load support access status");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchStatus();
    }, [fetchStatus]);

    const applyToggle = async (next: boolean) => {
        setToggling(true);
        try {
            await apiRequest("/api/admin/support-ensure", "POST", { ensure: next });
            await fetchStatus();
            onChanged();
            notify(
                next ? 'Support access enabled' : 'Support access disabled',
                { type: 'success' },
            );
        } catch (err: any) {
            setError(err?.message || "Failed to update support access");
        } finally {
            setToggling(false);
        }
    };

    const handleToggle = (next: boolean) => {
        // Disabling support access while there's no user key of last resort can
        // leave nobody able to reach the PCS — confirm before proceeding.
        if (!next && userKeyCount === 0) {
            setConfirmDisable(true);
            return;
        }
        void applyToggle(next);
    };

    return (
        <Card sx={card.root}>
            <Box sx={card.header}>
                <Typography sx={title.small}>Support access</Typography>
            </Box>
            <CardContent sx={card.content}>
                {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
                <Typography sx={{ ...text.detail, mb: 2 }}>
                    When enabled, support staff can SSH into <code>{status?.username || 'admin'}</code> using
                    the support key. A periodic self-check re-asserts this so the key isn&apos;t
                    silently lost on a manual edit or image refresh.
                </Typography>

                <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 1.5, flexWrap: 'wrap' }}>
                    <FormControlLabel
                        sx={{ m: 0 }}
                        control={
                            <Switch
                                checked={!!status?.ensure}
                                onChange={(_, v) => handleToggle(v)}
                                disabled={loading || toggling || !status}
                            />
                        }
                        label={
                            <Typography sx={{ ...text.label }}>
                                {status?.ensure ? "Enabled" : "Disabled"}
                            </Typography>
                        }
                    />
                    {(loading || toggling) && <CircularProgress size={16} />}
                    {status && (
                        <Chip
                            label={status.accessEnabled ? "Key present" : "Key absent"}
                            color={status.accessEnabled ? "success" : "default"}
                            size="small"
                        />
                    )}
                </Stack>

                {status && status.ensure !== status.accessEnabled && (
                    <Alert severity="warning" sx={{ mt: 1 }}>
                        {status.ensure
                            ? "Support access is enabled but the key is not currently in admin's authorized_keys. The next self-check tick will re-add it."
                            : "Support key is currently in admin's authorized_keys but the safety net is opted out. It will not be re-added if removed."}
                    </Alert>
                )}

                {status?.fingerprint && (
                    <Typography sx={{
                        ...text.detail,
                        mt: 1.5,
                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                        wordBreak: 'break-all',
                    }}>
                        {status.fingerprint} <span style={{ opacity: 0.7 }}>({status.comment})</span>
                    </Typography>
                )}
            </CardContent>

            <Dialog open={confirmDisable} onClose={() => setConfirmDisable(false)} maxWidth="sm" fullWidth>
                <DialogTitle>Disable support access?</DialogTitle>
                <DialogContent>
                    <Alert severity="warning" sx={{ mb: 2 }}>
                        There is no <strong>USER</strong> key on this PCS right now. The support key may be
                        the only remaining way in — if you disable it, you could lock yourself out of this PCS
                        entirely.
                    </Alert>
                    <DialogContentText>
                        Make sure you have added at least one of your own SSH keys (a <code>user-</code> key)
                        before disabling support access. Continue anyway?
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setConfirmDisable(false)} disabled={toggling}>Cancel</Button>
                    <Button
                        onClick={() => { setConfirmDisable(false); void applyToggle(false); }}
                        disabled={toggling}
                        color="error"
                        variant="contained"
                    >
                        Disable anyway
                    </Button>
                </DialogActions>
            </Dialog>
        </Card>
    );
};

const AccountBlock: React.FC<{
    account: HostAccount;
    dashboardAccount: string;
    onAddKey: () => void;
    onRemoveKey: (key: AuthorizedKey) => void;
}> = ({ account, dashboardAccount, onAddKey, onRemoveKey }) => {
    return (
        <Box sx={{
            border: `1px solid ${colors.borderMuted}`,
            borderRadius: 2,
            p: 2,
        }}>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1, flexWrap: 'wrap' }}>
                <Typography sx={text.label}>{account.username}</Typography>
                <Chip label={`UID ${account.uid}`} size="small" />
                {account.uid === 0 && (
                    <Chip label="ROOT" size="small" color="warning" />
                )}
                {account.isSystem && (
                    <Chip label="SYSTEM" size="small" />
                )}
                <Box sx={{ flexGrow: 1 }} />
                <Button
                    onClick={onAddKey}
                    startIcon={<AddIcon />}
                    size="small"
                    sx={button.primary}
                >
                    Add key
                </Button>
            </Stack>

            <Stack direction="row" spacing={3} sx={{ mb: 1, flexWrap: 'wrap' }}>
                <Typography sx={text.detail}>
                    <strong>Home:</strong> {account.home || '—'}
                </Typography>
                <Typography sx={text.detail}>
                    <strong>Shell:</strong> {account.shell || '—'}
                </Typography>
            </Stack>

            <Stack direction="row" spacing={3} sx={{ mb: 2, flexWrap: 'wrap' }}>
                <Typography sx={text.detail}>
                    <strong>Last login:</strong>{' '}
                    {account.lastLoginTime
                        ? `${account.lastLoginTime}`
                        : 'never (within recorded history)'}
                </Typography>
                {account.lastLoginFrom && (
                    <Typography sx={text.detail}>
                        <strong>From:</strong> {account.lastLoginFrom}
                    </Typography>
                )}
            </Stack>

            <Typography sx={{ ...text.label, fontSize: font.detail, mb: 1 }}>
                Authorized SSH keys ({account.authorizedKeys.length})
            </Typography>
            {account.authorizedKeysError && (
                <Alert severity="warning" sx={{ mb: 1 }}>{account.authorizedKeysError}</Alert>
            )}
            {account.authorizedKeys.length === 0 && !account.authorizedKeysError && (
                <Typography sx={text.detail}>No authorized keys.</Typography>
            )}
            {account.authorizedKeys.length > 0 && (
                <Box sx={{ overflowX: 'auto' }}>
                    <Table size="small">
                        <TableHead>
                            <TableRow>
                                <TableCell sx={tableHeadCell}>Type</TableCell>
                                <TableCell sx={tableHeadCell}>Fingerprint</TableCell>
                                <TableCell sx={tableHeadCell}>Comment</TableCell>
                                <TableCell sx={tableHeadCell}>Tag</TableCell>
                                <TableCell sx={tableHeadCell} align="right"></TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {account.authorizedKeys.map((key, idx) => {
                                // Deletion is locked for dashboard-managed admin
                                // keys, but only on the account the dashboard
                                // logs into. A leftover copy on root (older PCS)
                                // is stale and stays freely removable.
                                const isProtected = key.isAdminKey
                                    && account.username === dashboardAccount;
                                return (
                                <TableRow key={idx}>
                                    <TableCell sx={tableBodyCell}>
                                        {key.type}{key.bits ? ` ${key.bits}` : ''}
                                    </TableCell>
                                    <TableCell sx={{
                                        ...tableBodyCell,
                                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                                        wordBreak: 'break-all',
                                    }}>
                                        {key.fingerprint || '—'}
                                    </TableCell>
                                    <TableCell sx={tableBodyCell}>{key.comment || '—'}</TableCell>
                                    <TableCell sx={tableBodyCell}>
                                        {key.isLiveDashboardKey ? (
                                            <Chip label="THIS DASHBOARD" size="small" color="info" />
                                        ) : key.isSupportKey ? (
                                            <Chip label="SUPPORT" size="small" color="warning" />
                                        ) : key.isUserKey ? (
                                            <Chip label="USER" size="small" color="success" />
                                        ) : (
                                            <Chip label="UNKNOWN" size="small" />
                                        )}
                                    </TableCell>
                                    <TableCell sx={tableBodyCell} align="right">
                                        <IconButton
                                            size="small"
                                            disabled={!key.fingerprint || isProtected}
                                            title={
                                                !key.fingerprint
                                                    ? 'Cannot remove: fingerprint unavailable'
                                                    : isProtected
                                                        ? 'Dashboard key — managed automatically'
                                                        : 'Remove this key'
                                            }
                                            onClick={() => onRemoveKey(key)}
                                            sx={{ color: colors.textMuted }}
                                        >
                                            <DeleteOutlineIcon fontSize="small" />
                                        </IconButton>
                                    </TableCell>
                                </TableRow>
                                );
                            })}
                        </TableBody>
                    </Table>
                </Box>
            )}
        </Box>
    );
};

const monoInput = {
    style: {
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        fontSize: 13,
    },
};

type AddKeyMode = 'paste' | 'generate';

const AddKeyDialog: React.FC<{
    username: string | null;
    onClose: () => void;
    onAdded: () => void;
}> = ({ username, onClose, onAdded }) => {
    const notify = useNotify();
    const [mode, setMode] = useState<AddKeyMode>('paste');
    const [publicKey, setPublicKey] = useState<string>("");
    const [submitting, setSubmitting] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);

    // Generation state (generate mode only).
    const [generating, setGenerating] = useState<boolean>(false);
    const [generated, setGenerated] = useState<GeneratedKey | null>(null);
    const [genError, setGenError] = useState<string | null>(null);
    const [downloaded, setDownloaded] = useState<boolean>(false);

    const genSupported = isEd25519GenerationSupported();

    useEffect(() => {
        if (username !== null) {
            setMode('paste');
            setPublicKey("");
            setError(null);
            setSubmitting(false);
            setGenerating(false);
            setGenerated(null);
            setGenError(null);
            setDownloaded(false);
        }
    }, [username]);

    const handleModeChange = (next: AddKeyMode | null) => {
        if (!next || next === mode) return;
        setMode(next);
        setError(null);
        // Carry the generated key into the paste field, clear it otherwise.
        setPublicKey(next === 'generate' ? (generated?.publicKey ?? "") : "");
    };

    const handleGenerate = async () => {
        if (!username) return;
        setGenerating(true);
        setGenError(null);
        setDownloaded(false);
        try {
            const key = await generateEd25519Key(`user-${username}`);
            setGenerated(key);
            setPublicKey(key.publicKey);
        } catch (err: any) {
            setGenError(err?.message || "Key generation failed in this browser");
        } finally {
            setGenerating(false);
        }
    };

    const handleCopyPublic = async () => {
        if (!generated) return;
        try {
            await navigator.clipboard.writeText(generated.publicKey);
            notify('Public key copied to clipboard', { type: 'info' });
        } catch {
            notify('Could not copy — select and copy manually', { type: 'warning' });
        }
    };

    const handleDownloadPrivate = () => {
        if (!generated) return;
        const blob = new Blob([generated.privateKey], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `id_ed25519_${username}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        setDownloaded(true);
    };

    const handleSubmit = async () => {
        if (!username) return;
        setSubmitting(true);
        setError(null);
        try {
            await apiRequest<{ status: string }>(
                "/api/admin/access-add-key",
                "POST",
                { username, publicKey },
            );
            onAdded();
        } catch (err: any) {
            setError(err?.message || "Failed to add key");
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Dialog open={username !== null} onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle>Add SSH key for {username}</DialogTitle>
            <DialogContent>
                <ToggleButtonGroup
                    value={mode}
                    exclusive
                    size="small"
                    onChange={(_, v) => handleModeChange(v)}
                    sx={{ mb: 2 }}
                >
                    <ToggleButton value="paste">Paste a key</ToggleButton>
                    <ToggleButton value="generate" disabled={!genSupported}>Generate a new key</ToggleButton>
                </ToggleButtonGroup>

                {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

                {mode === 'paste' && (
                    <>
                        <DialogContentText sx={{ mb: 2 }}>
                            Paste a single OpenSSH public key (e.g. <code>ssh-ed25519 AAAA… comment</code>).
                            It will be appended to <code>~/.ssh/authorized_keys</code> for this account.
                        </DialogContentText>
                        <TextField
                            autoFocus
                            multiline
                            minRows={4}
                            fullWidth
                            placeholder="ssh-ed25519 AAAA... user@host"
                            value={publicKey}
                            onChange={e => setPublicKey(e.target.value)}
                            disabled={submitting}
                            inputProps={monoInput}
                        />
                    </>
                )}

                {mode === 'generate' && (
                    <>
                        {!genSupported && (
                            <Alert severity="error" sx={{ mb: 2 }}>
                                This browser does not support in-browser Ed25519 key generation.
                                Use a recent browser, or paste a key instead.
                            </Alert>
                        )}
                        <DialogContentText sx={{ mb: 2 }}>
                            Generate a brand-new Ed25519 keypair in your browser. The private key is created
                            here and <strong>never sent to the server</strong> — only the public key is added
                            to <code>~/.ssh/authorized_keys</code>. The comment is stamped <code>user-{username}</code> so
                            it is tagged as a USER key.
                        </DialogContentText>

                        {!generated && (
                            <Button
                                onClick={handleGenerate}
                                disabled={generating || !genSupported}
                                variant="contained"
                                startIcon={generating ? <CircularProgress size={14} /> : <AddIcon />}
                            >
                                Generate Ed25519 key
                            </Button>
                        )}
                        {genError && <Alert severity="error" sx={{ mt: 2 }}>{genError}</Alert>}

                        {generated && (
                            <Stack spacing={2}>
                                <Alert severity="warning">
                                    <Typography sx={{ fontWeight: 700, mb: 0.5 }}>
                                        Save the private key now — it is shown only once.
                                    </Typography>
                                    Download it and store it somewhere safe (a password manager or an encrypted
                                    disk). It never leaves this browser and cannot be recovered later. Anyone with
                                    this file can log into <code>{username}</code> on this PCS.
                                </Alert>

                                <Box>
                                    <Typography sx={{ ...text.label, mb: 0.5 }}>Public key</Typography>
                                    <TextField
                                        multiline
                                        minRows={2}
                                        fullWidth
                                        value={generated.publicKey}
                                        InputProps={{ readOnly: true }}
                                        inputProps={monoInput}
                                    />
                                    <Typography sx={{ ...text.detail, mt: 0.5, wordBreak: 'break-all' }}>
                                        {generated.fingerprint}
                                    </Typography>
                                </Box>

                                <Stack direction="row" spacing={1.5} flexWrap="wrap">
                                    <Button
                                        onClick={handleDownloadPrivate}
                                        variant="contained"
                                        color={downloaded ? 'success' : 'primary'}
                                        startIcon={<DownloadIcon />}
                                    >
                                        {downloaded ? 'Private key downloaded' : 'Download private key'}
                                    </Button>
                                    <Button onClick={handleCopyPublic} startIcon={<ContentCopyIcon />}>
                                        Copy public key
                                    </Button>
                                    <Button onClick={handleGenerate} disabled={generating}>
                                        Regenerate
                                    </Button>
                                </Stack>
                            </Stack>
                        )}
                    </>
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose} disabled={submitting}>Cancel</Button>
                <Button
                    onClick={handleSubmit}
                    disabled={submitting || publicKey.trim().length === 0}
                    variant="contained"
                    startIcon={submitting ? <CircularProgress size={14} /> : null}
                >
                    Add key
                </Button>
            </DialogActions>
        </Dialog>
    );
};

const RemoveKeyDialog: React.FC<{
    target: RemoveTarget | null;
    onClose: () => void;
    onRemoved: () => void;
}> = ({ target, onClose, onRemoved }) => {
    const [submitting, setSubmitting] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (target !== null) {
            setError(null);
            setSubmitting(false);
        }
    }, [target]);

    const handleSubmit = async () => {
        if (!target) return;
        setSubmitting(true);
        setError(null);
        try {
            await apiRequest<{ status: string; removed: number }>(
                "/api/admin/access-remove-key",
                "POST",
                { username: target.username, fingerprint: target.fingerprint },
            );
            onRemoved();
        } catch (err: any) {
            setError(err?.message || "Failed to remove key");
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Dialog open={target !== null} onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle>Remove SSH key?</DialogTitle>
            <DialogContent>
                <DialogContentText sx={{ mb: 2 }}>
                    This will remove the following key from <code>{target?.username}</code>&apos;s
                    <code> ~/.ssh/authorized_keys</code>. Anyone holding the matching private key
                    will lose SSH access immediately.
                </DialogContentText>
                {target?.leavesNoUserKey && (
                    <Alert severity="warning" sx={{ mb: 2 }}>
                        Removing this key would leave <strong>no USER key</strong> on this PCS. You need at least
                        one way to access the PCS — this may lock you out. Add a <code>user-</code> key first
                        unless you are sure another route in (e.g. support access) is available.
                    </Alert>
                )}
                <Box sx={{
                    p: 1.5,
                    border: `1px solid ${colors.borderMuted}`,
                    borderRadius: 1,
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                    fontSize: 13,
                    wordBreak: 'break-all',
                    mb: 2,
                }}>
                    <div>{target?.fingerprint}</div>
                    {target?.comment && <div style={{ opacity: 0.7, marginTop: 4 }}>{target.comment}</div>}
                </Box>
                {error && <Alert severity="error">{error}</Alert>}
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose} disabled={submitting}>Cancel</Button>
                <Button
                    onClick={handleSubmit}
                    disabled={submitting}
                    color="error"
                    variant="contained"
                    startIcon={submitting ? <CircularProgress size={14} /> : <DeleteOutlineIcon />}
                >
                    Remove
                </Button>
            </DialogActions>
        </Dialog>
    );
};

type TrustLevel = 'unknown' | 'tls-verified' | 'trusted';

interface FetchPubkeyResponse {
    url: string;
    hostname: string;
    trusted: boolean;
    type: string;
    publicKey: string;
    comment: string;
    fingerprint: string;
}

interface ResolvedKey {
    type: string;
    full: string;
    comment: string;
    fingerprint: string | null;
}

const AuthorizeDeeplinkCard: React.FC<{
    requestedAccount: string | null;
    rawPubkey: string | null;
    pubkeyUrl: string | null;
    accounts: HostAccount[] | null;
    accountsLoaded: boolean;
    onDismiss: () => void;
    onAdded: (status: 'added' | 'already-present' | 'unknown') => void;
}> = ({ requestedAccount, rawPubkey, pubkeyUrl, accounts, accountsLoaded, onDismiss, onAdded }) => {
    const parsedRawKey = useMemo(() => parsePublicKey(rawPubkey), [rawPubkey]);
    const [rawFingerprint, setRawFingerprint] = useState<string | null>(null);

    const [fetchedKey, setFetchedKey] = useState<FetchPubkeyResponse | null>(null);
    const [fetchLoading, setFetchLoading] = useState<boolean>(false);
    const [fetchError, setFetchError] = useState<string | null>(null);

    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        if (parsedRawKey) {
            computeFingerprint(parsedRawKey.b64).then(fp => {
                if (!cancelled) setRawFingerprint(fp);
            });
        } else {
            setRawFingerprint(null);
        }
        return () => { cancelled = true; };
    }, [parsedRawKey]);

    useEffect(() => {
        let cancelled = false;
        if (!pubkeyUrl) {
            setFetchedKey(null);
            setFetchError(null);
            setFetchLoading(false);
            return;
        }
        setFetchLoading(true);
        setFetchError(null);
        setFetchedKey(null);
        apiRequest<FetchPubkeyResponse>(
            `/api/admin/access-fetch-pubkey?url=${encodeURIComponent(pubkeyUrl)}`,
            'GET',
        ).then(res => {
            if (cancelled) return;
            setFetchedKey(res);
        }).catch(err => {
            if (cancelled) return;
            setFetchError(err?.message || 'Failed to fetch public key from URL');
        }).finally(() => {
            if (!cancelled) setFetchLoading(false);
        });
        return () => { cancelled = true; };
    }, [pubkeyUrl]);

    const accountExists = accountsLoaded && accounts !== null && requestedAccount !== null
        && accounts.some(a => a.username === requestedAccount);
    const accountUnknown = accountsLoaded && !accountExists;

    // Resolve effective key: pubkeyUrl wins over raw pubkey when both are present
    let resolvedKey: ResolvedKey | null = null;
    let trust: TrustLevel = 'unknown';
    let identityLabel: string | null = null;
    if (pubkeyUrl) {
        if (fetchedKey) {
            resolvedKey = {
                type: fetchedKey.type,
                full: fetchedKey.publicKey,
                comment: fetchedKey.comment,
                fingerprint: fetchedKey.fingerprint,
            };
            trust = fetchedKey.trusted ? 'trusted' : 'tls-verified';
            identityLabel = fetchedKey.hostname;
        }
    } else if (parsedRawKey) {
        resolvedKey = {
            type: parsedRawKey.type,
            full: parsedRawKey.full,
            comment: parsedRawKey.comment,
            fingerprint: rawFingerprint,
        };
        trust = 'unknown';
    }

    let problem: string | null = null;
    if (!requestedAccount) {
        problem = 'This authorization link is missing the target account name.';
    } else if (!rawPubkey && !pubkeyUrl) {
        problem = 'This authorization link is missing the public key.';
    } else if (pubkeyUrl && !fetchedKey && !fetchLoading && fetchError) {
        problem = fetchError;
    } else if (!pubkeyUrl && rawPubkey && !parsedRawKey) {
        problem = 'The public key in this link is malformed or uses an unsupported type.';
    } else if (accountUnknown) {
        problem = `Account '${requestedAccount}' does not exist on this PCS.`;
    }

    const tone = TRUST_TONE[trust];

    const handleConsent = async () => {
        if (!requestedAccount || !resolvedKey) return;
        setSubmitting(true);
        setSubmitError(null);
        try {
            const res = await apiRequest<{ status: 'added' | 'already-present' | 'unknown' }>(
                '/api/admin/access-add-key',
                'POST',
                { username: requestedAccount, publicKey: resolvedKey.full },
            );
            onAdded(res.status);
        } catch (err: any) {
            setSubmitError(err?.message || 'Failed to add key');
        } finally {
            setSubmitting(false);
        }
    };

    const consentLabel = trust === 'unknown'
        ? 'I consent to give access to the person who gave me the link'
        : `I consent to give access to ${identityLabel}`;

    const ready = !problem && (pubkeyUrl ? !fetchLoading && !!fetchedKey : !!parsedRawKey) && accountsLoaded;

    return (
        <Card sx={{ ...card.root, border: `2px solid ${tone.color}` }}>
            <Box sx={card.header}>
                <Stack direction="row" alignItems="center" spacing={1.5}>
                    <WarningAmberIcon sx={{ color: tone.color }} />
                    <Typography sx={{ ...title.small, color: tone.color }}>
                        Authorize SSH access?
                    </Typography>
                </Stack>
            </Box>
            <CardContent sx={card.content}>
                <Stack spacing={2}>
                    {/* Identity banner — present only in url mode */}
                    {pubkeyUrl && (
                        <Box sx={{
                            border: `1px solid ${tone.color}`,
                            borderRadius: 2,
                            p: 2,
                            backgroundColor: tone.tint,
                        }}>
                            {fetchLoading ? (
                                <Stack direction="row" alignItems="center" spacing={1.5}>
                                    <CircularProgress size={16} />
                                    <Typography sx={text.bodyWhite}>Fetching identity from {pubkeyUrl}…</Typography>
                                </Stack>
                            ) : fetchedKey ? (
                                <>
                                    <Typography sx={{ ...text.detail, fontWeight: 700, mb: 0.5, color: tone.color }}>
                                        {trust === 'trusted'
                                            ? 'Trusted source — verified via TLS'
                                            : 'Verified to come from this domain via TLS'}
                                    </Typography>
                                    <Typography sx={{ ...text.bodyWhite, fontSize: font.title, fontWeight: 700 }}>
                                        {fetchedKey.hostname}
                                    </Typography>
                                    <Typography sx={{ ...text.detail, wordBreak: 'break-all', mt: 0.5 }}>
                                        {fetchedKey.url}
                                    </Typography>
                                    {trust === 'tls-verified' && (
                                        <Typography sx={{ ...text.detail, mt: 1 }}>
                                            TLS confirms the key was served by <strong>{fetchedKey.hostname}</strong>.
                                            You still need to know that this domain belongs to who you think it does.
                                        </Typography>
                                    )}
                                </>
                            ) : (
                                <Typography sx={{ ...text.bodyWhite, color: colors.statusErrorAlt }}>
                                    {fetchError || 'Could not fetch from URL.'}
                                </Typography>
                            )}
                        </Box>
                    )}

                    {/* Risk explainer — same body, severity scales with trust */}
                    <Alert severity={tone.severity} icon={false} sx={{ '& .MuiAlert-message': { width: '100%' } }}>
                        <Typography sx={{ ...text.bodyWhite, fontWeight: 700, mb: 1 }}>
                            {trust === 'trusted'
                                ? `${identityLabel} is asking to add an SSH key to this PCS.`
                                : trust === 'tls-verified'
                                    ? `${identityLabel} is asking to add an SSH key to this PCS.`
                                    : 'An external link is asking to add an SSH key to this PCS.'}
                        </Typography>
                        <Typography sx={text.bodyWhite}>
                            If you grant this, the holder of the matching private key will be able to log in
                            over SSH and gain full control of this PCS. They can:
                        </Typography>
                        <Box component="ul" sx={{ ...text.bodyWhite, pl: 3, my: 1 }}>
                            <li>Read every file on this PCS — documents, photos, app data, secrets.</li>
                            <li>Modify or <strong>permanently delete</strong> any file. Deleted files cannot be recovered.</li>
                            <li>Install, remove, or replace any application or service.</li>
                        </Box>
                        <Typography sx={{ ...text.bodyWhite, fontWeight: 700 }}>
                            {trust === 'trusted'
                                ? `Only proceed if you actually requested support from ${identityLabel}.`
                                : trust === 'tls-verified'
                                    ? `Only proceed if you trust ${identityLabel} AND asked them for access.`
                                    : 'Only proceed if you personally trust the person who sent you this link AND you asked them for access. If you did not ask for this, or the link came from an unexpected source, cancel.'}
                        </Typography>
                    </Alert>

                    {problem ? (
                        <Alert severity="error">
                            {problem} Request rejected — nothing was changed.
                        </Alert>
                    ) : !accountsLoaded ? (
                        <Stack direction="row" alignItems="center" spacing={1.5}>
                            <CircularProgress size={16} />
                            <Typography sx={text.bodyMuted}>Verifying target account…</Typography>
                        </Stack>
                    ) : resolvedKey ? (
                        <Box sx={{
                            border: `1px solid ${colors.borderMuted}`,
                            borderRadius: 2,
                            p: 2,
                        }}>
                            <Typography sx={{ ...text.label, mb: 1.5 }}>The link wants to add this key:</Typography>
                            <DeeplinkField label="Account" value={requestedAccount!} />
                            <DeeplinkField label="Key type" value={resolvedKey.type} />
                            <DeeplinkField
                                label="Fingerprint"
                                value={resolvedKey.fingerprint || 'computing…'}
                                mono
                            />
                            {resolvedKey.comment && (
                                <DeeplinkField label="Comment" value={resolvedKey.comment} />
                            )}
                        </Box>
                    ) : null}

                    {submitError && <Alert severity="error">{submitError}</Alert>}

                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} justifyContent="flex-end">
                        <Button
                            onClick={onDismiss}
                            disabled={submitting}
                            sx={{ ...button.primary, padding: '12px 30px' }}
                        >
                            I don&apos;t understand — cancel
                        </Button>
                        <Button
                            onClick={handleConsent}
                            disabled={submitting || !ready}
                            startIcon={submitting ? <CircularProgress size={14} /> : undefined}
                            sx={consentButtonSx(tone.color)}
                        >
                            {consentLabel}
                        </Button>
                    </Stack>
                </Stack>
            </CardContent>
        </Card>
    );
};

const TRUST_TONE: Record<TrustLevel, {
    color: string;
    tint: string;
    severity: 'error' | 'warning' | 'info';
}> = {
    'unknown':      { color: colors.statusErrorAlt, tint: 'rgba(244, 67, 54, 0.08)', severity: 'error' },
    'tls-verified': { color: colors.statusWarning,  tint: 'rgba(255, 167, 38, 0.10)', severity: 'warning' },
    'trusted':      { color: colors.statusInfo,     tint: 'rgba(41, 182, 246, 0.10)', severity: 'info' },
};

const consentButtonSx = (toneColor: string) => ({
    fontSize: font.label,
    fontWeight: 700,
    padding: '12px 30px',
    borderRadius: '30px',
    textTransform: 'none' as const,
    color: toneColor,
    border: `1px solid ${toneColor}`,
    '&:hover': {
        borderColor: toneColor,
        backgroundColor: 'rgba(255,255,255,0.04)',
    },
    '&.Mui-disabled': {
        color: `${toneColor}66`,
        borderColor: `${toneColor}55`,
    },
});

const DeeplinkField: React.FC<{ label: string; value: string; mono?: boolean }> = ({ label, value, mono }) => (
    <Stack direction="row" spacing={1.5} sx={{ mb: 0.5, flexWrap: 'wrap' }}>
        <Typography sx={{ ...text.detail, minWidth: 110, fontWeight: 700 }}>{label}:</Typography>
        <Typography
            sx={{
                ...text.detail,
                wordBreak: 'break-all',
                fontFamily: mono
                    ? 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'
                    : undefined,
            }}
        >
            {value}
        </Typography>
    </Stack>
);

