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
    IconButton,
    Stack,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableRow,
    TextField,
    Typography,
} from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import { useNotify } from "react-admin";
import { useSearchParams } from "react-router-dom";
import { apiRequest } from "@/core/authApi";
import { button, card, colors, font, spacing, text, title } from "@/app/pages/softTheme";

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
    const deeplinkActive = !deeplinkDismissed && (deeplinkAccount !== null || deeplinkPubkey !== null);

    const clearDeeplink = useCallback(() => {
        setSearchParams(prev => {
            const next = new URLSearchParams(prev);
            next.delete('account');
            next.delete('pubkey');
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
                                    onAddKey={() => setAddKeyTarget(account.username)}
                                    onRemoveKey={(key) => setRemoveTarget({
                                        username: account.username,
                                        fingerprint: key.fingerprint,
                                        comment: key.comment,
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

const AccountBlock: React.FC<{
    account: HostAccount;
    onAddKey: () => void;
    onRemoveKey: (key: AuthorizedKey) => void;
}> = ({ account, onAddKey, onRemoveKey }) => {
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
                            {account.authorizedKeys.map((key, idx) => (
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
                                        {key.isAdminKey ? (
                                            <Chip label="dashboard" size="small" color="info" />
                                        ) : (
                                            <Chip label="user" size="small" />
                                        )}
                                    </TableCell>
                                    <TableCell sx={tableBodyCell} align="right">
                                        <IconButton
                                            size="small"
                                            disabled={!key.fingerprint || key.isAdminKey}
                                            title={
                                                !key.fingerprint
                                                    ? 'Cannot remove: fingerprint unavailable'
                                                    : key.isAdminKey
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
                            ))}
                        </TableBody>
                    </Table>
                </Box>
            )}
        </Box>
    );
};

const AddKeyDialog: React.FC<{
    username: string | null;
    onClose: () => void;
    onAdded: () => void;
}> = ({ username, onClose, onAdded }) => {
    const [publicKey, setPublicKey] = useState<string>("");
    const [submitting, setSubmitting] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (username !== null) {
            setPublicKey("");
            setError(null);
            setSubmitting(false);
        }
    }, [username]);

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
                <DialogContentText sx={{ mb: 2 }}>
                    Paste a single OpenSSH public key (e.g. <code>ssh-ed25519 AAAA… comment</code>).
                    It will be appended to <code>~/.ssh/authorized_keys</code> for this account.
                </DialogContentText>
                {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
                <TextField
                    autoFocus
                    multiline
                    minRows={4}
                    fullWidth
                    placeholder="ssh-ed25519 AAAA... user@host"
                    value={publicKey}
                    onChange={e => setPublicKey(e.target.value)}
                    disabled={submitting}
                    inputProps={{
                        style: {
                            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                            fontSize: 13,
                        },
                    }}
                />
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
                    This will remove the following key from <code>{target?.username}</code>'s
                    <code> ~/.ssh/authorized_keys</code>. Anyone holding the matching private key
                    will lose SSH access immediately.
                </DialogContentText>
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

const AuthorizeDeeplinkCard: React.FC<{
    requestedAccount: string | null;
    rawPubkey: string | null;
    accounts: HostAccount[] | null;
    accountsLoaded: boolean;
    onDismiss: () => void;
    onAdded: (status: 'added' | 'already-present' | 'unknown') => void;
}> = ({ requestedAccount, rawPubkey, accounts, accountsLoaded, onDismiss, onAdded }) => {
    const parsedKey = useMemo(() => parsePublicKey(rawPubkey), [rawPubkey]);
    const [fingerprint, setFingerprint] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        if (parsedKey) {
            computeFingerprint(parsedKey.b64).then(fp => {
                if (!cancelled) setFingerprint(fp);
            });
        } else {
            setFingerprint(null);
        }
        return () => { cancelled = true; };
    }, [parsedKey]);

    const accountExists = accountsLoaded && accounts !== null && requestedAccount !== null
        && accounts.some(a => a.username === requestedAccount);
    const accountUnknown = accountsLoaded && !accountExists;

    let problem: string | null = null;
    if (!requestedAccount) {
        problem = 'This authorization link is missing the target account name.';
    } else if (!rawPubkey) {
        problem = 'This authorization link is missing the public key.';
    } else if (!parsedKey) {
        problem = 'The public key in this link is malformed or uses an unsupported type.';
    } else if (accountUnknown) {
        problem = `Account '${requestedAccount}' does not exist on this PCS.`;
    }

    const handleConsent = async () => {
        if (!requestedAccount || !parsedKey) return;
        setSubmitting(true);
        setSubmitError(null);
        try {
            const res = await apiRequest<{ status: 'added' | 'already-present' | 'unknown' }>(
                '/api/admin/access-add-key',
                'POST',
                { username: requestedAccount, publicKey: parsedKey.full },
            );
            onAdded(res.status);
        } catch (err: any) {
            setSubmitError(err?.message || 'Failed to add key');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Card sx={dangerCard}>
            <Box sx={card.header}>
                <Stack direction="row" alignItems="center" spacing={1.5}>
                    <WarningAmberIcon sx={{ color: colors.statusErrorAlt }} />
                    <Typography sx={{ ...title.small, color: colors.statusErrorAlt }}>
                        Authorize SSH access?
                    </Typography>
                </Stack>
            </Box>
            <CardContent sx={card.content}>
                <Stack spacing={2}>
                    <Alert severity="error" icon={false} sx={{ '& .MuiAlert-message': { width: '100%' } }}>
                        <Typography sx={{ ...text.bodyWhite, fontWeight: 700, mb: 1 }}>
                            An external link is asking to add an SSH key to this PCS.
                        </Typography>
                        <Typography sx={text.bodyWhite}>
                            If you grant this, the holder of the matching private key will be able to log in
                            over SSH and gain full control of this PCS. They can:
                        </Typography>
                        <Box component="ul" sx={{ ...text.bodyWhite, pl: 3, my: 1 }}>
                            <li>Read every file on this PCS — documents, photos, app data, secrets.</li>
                            <li>Modify or <strong>permanently delete</strong> any file. Deleted files cannot be recovered.</li>
                            <li>Install, remove, or replace any application or service.</li>
                            <li>Install hidden backdoors that can survive reboots and key removal.</li>
                        </Box>
                        <Typography sx={{ ...text.bodyWhite, fontWeight: 700 }}>
                            Only proceed if you personally trust the person who sent you this link AND you
                            asked them for access. If you did not ask for this, or the link came from an
                            unexpected source, cancel.
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
                    ) : (
                        <Box sx={{
                            border: `1px solid ${colors.borderMuted}`,
                            borderRadius: 2,
                            p: 2,
                        }}>
                            <Typography sx={{ ...text.label, mb: 1.5 }}>The link wants to add this key:</Typography>
                            <DeeplinkField label="Account" value={requestedAccount!} />
                            <DeeplinkField label="Key type" value={parsedKey!.type} />
                            <DeeplinkField
                                label="Fingerprint"
                                value={fingerprint || 'computing…'}
                                mono
                            />
                            {parsedKey!.comment && (
                                <DeeplinkField label="Comment" value={parsedKey!.comment} />
                            )}
                        </Box>
                    )}

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
                            disabled={submitting || problem !== null || !accountsLoaded}
                            startIcon={submitting ? <CircularProgress size={14} /> : undefined}
                            sx={dangerOutlineButton}
                        >
                            I consent to give access to the person who gave me the link
                        </Button>
                    </Stack>
                </Stack>
            </CardContent>
        </Card>
    );
};

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

const dangerCard = {
    ...card.root,
    border: `2px solid ${colors.statusErrorAlt}`,
};

const dangerOutlineButton = {
    fontSize: font.label,
    fontWeight: 700,
    padding: '12px 30px',
    borderRadius: '30px',
    textTransform: 'none' as const,
    color: colors.statusErrorAlt,
    border: `1px solid ${colors.statusErrorAlt}`,
    '&:hover': {
        borderColor: colors.statusErrorAlt,
        backgroundColor: 'rgba(244, 67, 54, 0.08)',
    },
    '&.Mui-disabled': {
        color: 'rgba(244, 67, 54, 0.4)',
        borderColor: 'rgba(244, 67, 54, 0.3)',
    },
};
