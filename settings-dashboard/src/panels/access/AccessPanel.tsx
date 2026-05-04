import React, { useCallback, useEffect, useState } from "react";
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
import { apiRequest } from "@/core/authApi";
import { button, card, colors, font, spacing, text, title } from "@/app/pages/softTheme";

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
    const [data, setData] = useState<AccessInfoResponse | null>(null);
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);
    const [addKeyTarget, setAddKeyTarget] = useState<string | null>(null);
    const [removeTarget, setRemoveTarget] = useState<RemoveTarget | null>(null);

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
