import React, {useCallback, useEffect, useState} from "react";
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
    Tooltip,
    Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import KeyIcon from "@mui/icons-material/Key";
import MailOutlineIcon from "@mui/icons-material/MailOutline";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import RefreshIcon from "@mui/icons-material/Refresh";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import {useNotify} from "react-admin";
import {apiRequest} from "@/core/authApi";
import {button, card, colors, font, spacing, title} from "@/app/pages/softTheme";

/**
 * AccountPanel — "Account" page.
 *
 * Three sections:
 *   1. Your account — who you are signed in as, and a link to Authelia's own
 *      portal, which is where password and 2FA self-service actually lives.
 *   2. Local accounts — add / revoke / reset the PCS's local users. Admin only.
 *   3. Onboarding — replay the first-start wizard by unclaiming the box. Admin
 *      only, and destructive: see the dialog copy and onboarding.sh.
 *
 * This is the ONLY panel a non-admin sees (see the `permissions` field on every
 * other definePanel call in App.tsx), so section 1 has to stand on its own.
 *
 * It replaces a set of link-out cards that pointed at CasaOS — removed in the
 * Maison migration — and so had been rendering a dead link. Authelia is the
 * local credential store now.
 */

interface MeUser {
    id: string;
    fullName: string;
    email: string;
    role: string;
}

interface AutheliaUser {
    username: string;
    displayname: string;
    email: string;
    groups: string[];
}

interface UsersListResponse {
    users: AutheliaUser[];
    currentUser: string;
    collectedAt: string;
}

interface GeneratedCredential {
    username: string;
    password: string;
}

interface OnboardingStatus {
    claimed: boolean;
    completed: boolean;
    username: string;
}

interface OnboardingResetResult {
    claimed: boolean;
    completed: boolean;
    username: string;
    backup: string;
}

// Typed into the confirmation field before the reset button unlocks. The host
// script guards itself with a mandatory `--confirm` flag for the same reason:
// this disables every local account on the PCS, and the account it locks out
// first is the one clicking the button.
const RESET_CONFIRM_WORD = "reset";

const ADMIN_GROUP = "admins";
// Matches PROTECTED_USER in scripts/tools/authelia-user-manager.sh — the seeded
// operator account, which the host script refuses to delete or re-address.
const PROTECTED_USER = "admin";

const tableHeadCell = {
    color: colors.textMuted,
    fontSize: font.caption,
    fontWeight: 700,
    letterSpacing: "0.75px",
    textTransform: "uppercase" as const,
    borderBottomColor: colors.borderMuted,
};

const tableBodyCell = {
    color: colors.textWhite,
    fontSize: font.detail,
    borderBottomColor: colors.borderMuted,
};

/**
 * Authelia's own portal, derived from the hostname this dashboard is served on.
 * The admin app and Authelia are routed at parallel `admin-${DOMAIN}` and
 * `local-auth-${DOMAIN}` labels for the gateway, nip.io and sslip.io variants
 * alike, so swapping the prefix is correct for every deployment shape without
 * depending on the (possibly empty) APP_CONFIG payload.
 */
const localAuthUrl = (): string | null => {
    if (typeof window === "undefined") return null;
    const host = window.location.host;
    const prefix = "admin-";
    if (!host.startsWith(prefix)) return null;
    return `https://local-auth-${host.slice(prefix.length)}/`;
};

const CopyableField: React.FC<{
    label: string;
    value: string;
    onCopy: (label: string, value: string) => void;
    mono?: boolean;
}> = ({label, value, onCopy, mono}) => (
    <TextField
        label={label}
        value={value}
        InputProps={{
            readOnly: true,
            sx: mono ? {fontFamily: "monospace"} : undefined,
            endAdornment: (
                <IconButton size="small" onClick={() => onCopy(label, value)} edge="end">
                    <ContentCopyIcon fontSize="small"/>
                </IconButton>
            ),
        }}
        fullWidth
        size="small"
    />
);

export const AccountPanel = () => {
    const notify = useNotify();

    const [me, setMe] = useState<MeUser | null>(null);
    const [meLoading, setMeLoading] = useState(true);

    const [users, setUsers] = useState<AutheliaUser[] | null>(null);
    const [currentUser, setCurrentUser] = useState<string>("");
    const [usersLoading, setUsersLoading] = useState(false);
    const [usersError, setUsersError] = useState<string | null>(null);

    // Add-user form
    const [addOpen, setAddOpen] = useState(false);
    const [newUsername, setNewUsername] = useState("");
    const [newDisplayname, setNewDisplayname] = useState("");
    const [newEmail, setNewEmail] = useState("");
    const [newIsAdmin, setNewIsAdmin] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    // Email edit
    const [emailTarget, setEmailTarget] = useState<AutheliaUser | null>(null);
    const [emailValue, setEmailValue] = useState("");

    // Onboarding replay
    const [onboarding, setOnboarding] = useState<OnboardingStatus | null>(null);
    const [resetOpen, setResetOpen] = useState(false);
    const [resetWord, setResetWord] = useState("");
    const [resetting, setResetting] = useState(false);

    // Confirmations + the one-time credential dialog
    const [revokeTarget, setRevokeTarget] = useState<AutheliaUser | null>(null);
    const [resetTarget, setResetTarget] = useState<AutheliaUser | null>(null);
    const [credential, setCredential] = useState<GeneratedCredential | null>(null);

    const isAdmin = me?.role === "admin";
    const authUrl = localAuthUrl();

    const copy = useCallback((label: string, value: string) => {
        navigator.clipboard.writeText(value).then(
            () => notify(`${label} copied`, {type: "info"}),
            () => notify("Copy failed", {type: "warning"}),
        );
    }, [notify]);

    useEffect(() => {
        let cancelled = false;
        apiRequest<{user: MeUser}>("/api/me")
            .then(data => { if (!cancelled) setMe(data.user); })
            .catch(() => { if (!cancelled) setMe(null); })
            .finally(() => { if (!cancelled) setMeLoading(false); });
        return () => { cancelled = true; };
    }, []);

    const loadUsers = useCallback(async () => {
        setUsersLoading(true);
        setUsersError(null);
        try {
            const data = await apiRequest<UsersListResponse>("/api/admin/users-list");
            setUsers(data.users);
            setCurrentUser(data.currentUser);
        } catch (err: any) {
            setUsersError(err?.message || "Failed to load local accounts");
        } finally {
            setUsersLoading(false);
        }
    }, []);

    const loadOnboarding = useCallback(async () => {
        try {
            setOnboarding(await apiRequest<OnboardingStatus>("/api/admin/onboarding-status"));
        } catch {
            // Informational only — the reset control stands without it.
            setOnboarding(null);
        }
    }, []);

    useEffect(() => {
        if (isAdmin) {
            void loadUsers();
            void loadOnboarding();
        }
    }, [isAdmin, loadUsers, loadOnboarding]);

    const resetAddForm = () => {
        setNewUsername("");
        setNewDisplayname("");
        setNewEmail("");
        setNewIsAdmin(false);
    };

    const submitAdd = async () => {
        setSubmitting(true);
        try {
            const created = await apiRequest<GeneratedCredential>("/api/admin/users-add", "POST", {
                username: newUsername.trim(),
                displayname: newDisplayname.trim(),
                email: newEmail.trim(),
                isAdmin: newIsAdmin,
            });
            setAddOpen(false);
            resetAddForm();
            setCredential(created);
            await loadUsers();
        } catch (err: any) {
            notify(err?.message || "Failed to create the account", {type: "warning"});
        } finally {
            setSubmitting(false);
        }
    };

    const submitRevoke = async () => {
        if (!revokeTarget) return;
        setSubmitting(true);
        try {
            await apiRequest("/api/admin/users-delete", "POST", {username: revokeTarget.username});
            notify(`Revoked ${revokeTarget.username}`, {type: "info"});
            setRevokeTarget(null);
            await loadUsers();
        } catch (err: any) {
            notify(err?.message || "Failed to revoke the account", {type: "warning"});
        } finally {
            setSubmitting(false);
        }
    };

    const submitReset = async () => {
        if (!resetTarget) return;
        setSubmitting(true);
        try {
            const created = await apiRequest<GeneratedCredential>(
                "/api/admin/users-set-password", "POST", {username: resetTarget.username});
            setResetTarget(null);
            setCredential(created);
        } catch (err: any) {
            notify(err?.message || "Failed to reset the password", {type: "warning"});
        } finally {
            setSubmitting(false);
        }
    };

    const submitReonboard = async () => {
        setResetting(true);
        try {
            const result = await apiRequest<OnboardingResetResult>(
                "/api/admin/onboarding-reset", "POST", {confirm: true});
            notify(
                result.backup
                    ? `Onboarding reset — previous accounts backed up to ${result.backup}`
                    : "Onboarding reset",
                {type: "info", autoHideDuration: 10000},
            );
            // Reload rather than re-render: OnboardingGate decides on mount, so
            // the blocking wizard only appears on a fresh load of the shell —
            // which is also the fastest way back to a working credential, and
            // this session cannot do anything else useful until there is one.
            window.location.reload();
        } catch (err: any) {
            notify(err?.message || "Failed to reset onboarding", {type: "warning"});
            setResetting(false);
        }
    };

    const submitEmail = async () => {
        if (!emailTarget) return;
        setSubmitting(true);
        try {
            await apiRequest("/api/admin/users-set-email", "POST", {
                username: emailTarget.username,
                email: emailValue.trim(),
            });
            notify(`Updated email for ${emailTarget.username}`, {type: "info"});
            setEmailTarget(null);
            await loadUsers();
        } catch (err: any) {
            notify(err?.message || "Failed to update the email", {type: "warning"});
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Box sx={{
            paddingTop: spacing.pageY,
            paddingBottom: spacing.pageY,
            paddingX: spacing.pageX,
            display: "flex",
            flexDirection: "column",
            gap: spacing.cardGap,
        }}>
            <Typography variant="h2" sx={title.large}>Account</Typography>

            {/* ---------------- Your account ---------------- */}
            <Card sx={card.root}>
                <Box sx={card.header}>
                    <Typography sx={title.small}>Your account</Typography>
                </Box>
                <CardContent sx={card.content}>
                    {meLoading ? (
                        <CircularProgress size={22}/>
                    ) : !me ? (
                        <Alert severity="warning">Could not load your identity.</Alert>
                    ) : (
                        <Stack spacing={2}>
                            <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap">
                                <Typography sx={{color: colors.textWhite, fontSize: font.label, fontWeight: 700}}>
                                    {me.fullName || me.id}
                                </Typography>
                                <Chip
                                    size="small"
                                    label={isAdmin ? "Administrator" : "User"}
                                    sx={{
                                        fontSize: font.caption,
                                        fontWeight: 700,
                                        color: isAdmin ? colors.statusSuccess : colors.textMuted,
                                        borderColor: isAdmin ? colors.statusSuccess : colors.borderMuted,
                                    }}
                                    variant="outlined"
                                />
                            </Stack>
                            <Typography sx={{color: colors.textMuted, fontSize: font.detail}}>
                                Signed in as <strong>{me.id}</strong>
                                {me.email ? <> &middot; {me.email}</> : null}
                            </Typography>
                            <Typography sx={{color: colors.textMuted, fontSize: font.detail, lineHeight: 1.6}}>
                                Your password and two-factor settings live in the sign-in portal,
                                which also handles password resets by email.
                            </Typography>
                            {authUrl && (
                                <Box>
                                    <Button
                                        startIcon={<OpenInNewIcon/>}
                                        href={authUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        sx={button.primary}
                                    >
                                        Manage sign-in
                                    </Button>
                                </Box>
                            )}
                        </Stack>
                    )}
                </CardContent>
            </Card>

            {/* ---------------- Local accounts (admin only) ---------------- */}
            {isAdmin && (
                <Card sx={card.root}>
                    <Box sx={{...card.header, display: "flex", alignItems: "center", justifyContent: "space-between"}}>
                        <Typography sx={title.small}>Local accounts</Typography>
                        <Stack direction="row" spacing={1}>
                            <Tooltip title="Refresh">
                                <span>
                                    <IconButton onClick={() => void loadUsers()} disabled={usersLoading}
                                                sx={{color: colors.textMuted}}>
                                        <RefreshIcon/>
                                    </IconButton>
                                </span>
                            </Tooltip>
                            <Button startIcon={<AddIcon/>} onClick={() => setAddOpen(true)} sx={button.primary}>
                                Add user
                            </Button>
                        </Stack>
                    </Box>
                    <CardContent sx={card.content}>
                        <Typography sx={{color: colors.textMuted, fontSize: font.detail, marginBottom: "16px", lineHeight: 1.6}}>
                            Accounts that can sign in to this PCS. Administrators get the full
                            dashboard; users get this page only.
                        </Typography>

                        {usersError && <Alert severity="error" sx={{marginBottom: "16px"}}>{usersError}</Alert>}

                        {usersLoading && !users ? (
                            <CircularProgress size={22}/>
                        ) : (
                            <Table size="small">
                                <TableHead>
                                    <TableRow>
                                        <TableCell sx={tableHeadCell}>Username</TableCell>
                                        <TableCell sx={tableHeadCell}>Display name</TableCell>
                                        <TableCell sx={tableHeadCell}>Email</TableCell>
                                        <TableCell sx={tableHeadCell}>Role</TableCell>
                                        <TableCell sx={tableHeadCell} align="right">Actions</TableCell>
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {(users ?? []).map(u => {
                                        const admin = u.groups.includes(ADMIN_GROUP);
                                        const isSelf = u.username === currentUser;
                                        const isProtected = u.username === PROTECTED_USER;
                                        const revokeBlockedReason = isProtected
                                            ? "The operator account cannot be revoked"
                                            : isSelf
                                                ? "You cannot revoke the account you are signed in as"
                                                : null;
                                        return (
                                            <TableRow key={u.username}>
                                                <TableCell sx={tableBodyCell}>
                                                    {u.username}{isSelf && " (you)"}
                                                </TableCell>
                                                <TableCell sx={tableBodyCell}>{u.displayname}</TableCell>
                                                <TableCell sx={tableBodyCell}>{u.email}</TableCell>
                                                <TableCell sx={tableBodyCell}>
                                                    <Chip
                                                        size="small"
                                                        variant="outlined"
                                                        label={admin ? "Administrator" : "User"}
                                                        sx={{
                                                            fontSize: font.caption,
                                                            color: admin ? colors.statusSuccess : colors.textMuted,
                                                            borderColor: admin ? colors.statusSuccess : colors.borderMuted,
                                                        }}
                                                    />
                                                </TableCell>
                                                <TableCell sx={tableBodyCell} align="right">
                                                    <Tooltip title={isProtected
                                                        ? "Managed by EMAIL in .ynd.user.env"
                                                        : "Change email"}>
                                                        <span>
                                                            <IconButton
                                                                size="small"
                                                                disabled={isProtected}
                                                                onClick={() => {
                                                                    setEmailTarget(u);
                                                                    setEmailValue(u.email);
                                                                }}
                                                                sx={{color: colors.textMuted}}
                                                            >
                                                                <MailOutlineIcon fontSize="small"/>
                                                            </IconButton>
                                                        </span>
                                                    </Tooltip>
                                                    <Tooltip title="Reset password">
                                                        <span>
                                                            <IconButton size="small" onClick={() => setResetTarget(u)}
                                                                        sx={{color: colors.textMuted}}>
                                                                <KeyIcon fontSize="small"/>
                                                            </IconButton>
                                                        </span>
                                                    </Tooltip>
                                                    <Tooltip title={revokeBlockedReason ?? "Revoke access"}>
                                                        <span>
                                                            <IconButton
                                                                size="small"
                                                                disabled={!!revokeBlockedReason}
                                                                onClick={() => setRevokeTarget(u)}
                                                                sx={{color: colors.statusError}}
                                                            >
                                                                <DeleteOutlineIcon fontSize="small"/>
                                                            </IconButton>
                                                        </span>
                                                    </Tooltip>
                                                </TableCell>
                                            </TableRow>
                                        );
                                    })}
                                    {users && users.length === 0 && (
                                        <TableRow>
                                            <TableCell sx={tableBodyCell} colSpan={5}>No local accounts.</TableCell>
                                        </TableRow>
                                    )}
                                </TableBody>
                            </Table>
                        )}
                    </CardContent>
                </Card>
            )}

            {/* ---------------- Onboarding (admin only) ---------------- */}
            {isAdmin && (
                <Card sx={card.root}>
                    <Box sx={card.header}>
                        <Typography sx={title.small}>Onboarding</Typography>
                    </Box>
                    <CardContent sx={card.content}>
                        <Stack spacing={2}>
                            <Typography sx={{color: colors.textMuted, fontSize: font.detail, lineHeight: 1.6}}>
                                The first-start wizard runs once, when this server has no local
                                account yet. Re-running it puts the server back into that state so
                                the owner account can be created again from scratch.
                            </Typography>
                            {onboarding && (
                                <Typography sx={{color: colors.textMuted, fontSize: font.detail}}>
                                    Currently{" "}
                                    <strong>{onboarding.claimed ? "claimed" : "unclaimed"}</strong>
                                    {onboarding.claimed && onboarding.username
                                        ? <> by <strong>{onboarding.username}</strong></>
                                        : null}.
                                </Typography>
                            )}
                            <Alert severity="warning">
                                This deletes <strong>every local account</strong> on this PCS and
                                signs you out of the dashboard until you create a new one. The
                                &ldquo;Local Account&rdquo; option disappears from the sign-in page
                                while the server is unclaimed, so if single sign-on is unavailable
                                the only way back in is SSH. Existing password hashes are backed up
                                next to the account database first.
                            </Alert>
                            <Box>
                                <Button
                                    startIcon={<RestartAltIcon/>}
                                    onClick={() => {
                                        setResetWord("");
                                        setResetOpen(true);
                                    }}
                                    sx={{...button.primary, backgroundColor: colors.statusErrorAlt}}
                                >
                                    Re-run onboarding
                                </Button>
                            </Box>
                        </Stack>
                    </CardContent>
                </Card>
            )}

            {/* ---------------- Add user ---------------- */}
            <Dialog open={addOpen} onClose={() => !submitting && setAddOpen(false)} fullWidth maxWidth="sm">
                <DialogTitle>Add a local account</DialogTitle>
                <DialogContent>
                    <Stack spacing={2} sx={{mt: 1}}>
                        <TextField
                            label="Username" value={newUsername} size="small" fullWidth autoFocus
                            onChange={e => setNewUsername(e.target.value)}
                            helperText="Lowercase letters, digits, '-' and '_'. Cannot be changed later."
                        />
                        <TextField
                            label="Display name" value={newDisplayname} size="small" fullWidth
                            onChange={e => setNewDisplayname(e.target.value)}
                        />
                        <TextField
                            label="Email" value={newEmail} size="small" fullWidth type="email"
                            onChange={e => setNewEmail(e.target.value)}
                            helperText="Used for password-reset mail."
                        />
                        <FormControlLabel
                            control={<Switch checked={newIsAdmin} onChange={e => setNewIsAdmin(e.target.checked)}/>}
                            label="Administrator (full dashboard access)"
                        />
                        {newIsAdmin && (
                            <Alert severity="warning">
                                Administrators get the whole dashboard, including the terminal and
                                SSH key management — effectively root on this server.
                            </Alert>
                        )}
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setAddOpen(false)} disabled={submitting}>Cancel</Button>
                    <Button
                        onClick={() => void submitAdd()}
                        disabled={submitting || !newUsername.trim() || !newDisplayname.trim() || !newEmail.trim()}
                        sx={button.primary}
                    >
                        {submitting ? "Creating…" : "Create"}
                    </Button>
                </DialogActions>
            </Dialog>

            {/* ---------------- One-time credential ---------------- */}
            <Dialog open={!!credential} onClose={() => setCredential(null)} fullWidth maxWidth="sm">
                <DialogTitle>One-time password</DialogTitle>
                <DialogContent>
                    <Stack spacing={2} sx={{mt: 1}}>
                        <Alert severity="info">
                            This password is shown <strong>once</strong> and cannot be retrieved
                            again. Copy it now and give it to the account holder — they can change
                            it from the sign-in portal.
                        </Alert>
                        {credential && (
                            <>
                                <CopyableField label="Username" value={credential.username} onCopy={copy}/>
                                <CopyableField label="Password" value={credential.password} onCopy={copy} mono/>
                            </>
                        )}
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setCredential(null)} sx={button.primary}>Done</Button>
                </DialogActions>
            </Dialog>

            {/* ---------------- Change email ---------------- */}
            <Dialog open={!!emailTarget} onClose={() => !submitting && setEmailTarget(null)} fullWidth maxWidth="sm">
                <DialogTitle>Change email</DialogTitle>
                <DialogContent>
                    <Stack spacing={2} sx={{mt: 1}}>
                        <Typography sx={{fontSize: font.detail}}>
                            Password-reset mail for <strong>{emailTarget?.username}</strong> will go
                            to this address.
                        </Typography>
                        <TextField
                            label="Email" value={emailValue} size="small" fullWidth type="email" autoFocus
                            onChange={e => setEmailValue(e.target.value)}
                        />
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setEmailTarget(null)} disabled={submitting}>Cancel</Button>
                    <Button onClick={() => void submitEmail()} disabled={submitting || !emailValue.trim()}
                            sx={button.primary}>
                        {submitting ? "Saving…" : "Save"}
                    </Button>
                </DialogActions>
            </Dialog>

            {/* ---------------- Reset password ---------------- */}
            <Dialog open={!!resetTarget} onClose={() => !submitting && setResetTarget(null)} fullWidth maxWidth="sm">
                <DialogTitle>Reset password</DialogTitle>
                <DialogContent>
                    <Typography sx={{fontSize: font.detail}}>
                        Generate a new one-time password for <strong>{resetTarget?.username}</strong>?
                        Their current password stops working immediately.
                    </Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setResetTarget(null)} disabled={submitting}>Cancel</Button>
                    <Button onClick={() => void submitReset()} disabled={submitting} sx={button.primary}>
                        {submitting ? "Resetting…" : "Reset password"}
                    </Button>
                </DialogActions>
            </Dialog>

            {/* ---------------- Revoke ---------------- */}
            <Dialog open={!!revokeTarget} onClose={() => !submitting && setRevokeTarget(null)} fullWidth maxWidth="sm">
                <DialogTitle>Revoke access</DialogTitle>
                <DialogContent>
                    <Typography sx={{fontSize: font.detail}}>
                        Delete the account <strong>{revokeTarget?.username}</strong>? They lose
                        access to this PCS and every app that signs in through it. This cannot be
                        undone.
                    </Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setRevokeTarget(null)} disabled={submitting}>Cancel</Button>
                    <Button onClick={() => void submitRevoke()} disabled={submitting}
                            sx={{...button.primary, backgroundColor: colors.statusErrorAlt}}>
                        {submitting ? "Revoking…" : "Revoke"}
                    </Button>
                </DialogActions>
            </Dialog>

            {/* ---------------- Re-run onboarding ---------------- */}
            <Dialog open={resetOpen} onClose={() => !resetting && setResetOpen(false)} fullWidth maxWidth="sm">
                <DialogTitle>Re-run onboarding</DialogTitle>
                <DialogContent>
                    <Stack spacing={2} sx={{mt: 1}}>
                        <Alert severity="error">
                            Every local account on this PCS is deleted and the setup wizard runs
                            again on the next page load. Your current session stops being useful
                            immediately.
                        </Alert>
                        <Typography sx={{fontSize: font.detail}}>
                            Password hashes are copied to a timestamped backup beside the account
                            database, but nothing signs in again until the wizard creates a new
                            owner account. Make sure you can still reach this server another way —
                            single sign-on or SSH — before continuing.
                        </Typography>
                        <TextField
                            label={`Type "${RESET_CONFIRM_WORD}" to confirm`}
                            value={resetWord}
                            size="small"
                            fullWidth
                            autoFocus
                            onChange={e => setResetWord(e.target.value)}
                        />
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setResetOpen(false)} disabled={resetting}>Cancel</Button>
                    <Button
                        onClick={() => void submitReonboard()}
                        disabled={resetting || resetWord.trim().toLowerCase() !== RESET_CONFIRM_WORD}
                        sx={{...button.primary, backgroundColor: colors.statusErrorAlt}}
                    >
                        {resetting ? "Resetting…" : "Re-run onboarding"}
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};
