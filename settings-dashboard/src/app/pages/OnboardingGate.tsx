import React, {useCallback, useEffect, useState} from 'react';
import {
    Alert,
    Backdrop,
    Box,
    Button,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    IconButton,
    Stack,
    TextField,
    Tooltip,
    Typography,
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import {apiRequest} from '@/core/authApi';
import {button, colors, font, spacing, title} from '@/app/pages/softTheme';

/**
 * First-start onboarding gate.
 *
 * Wraps the whole app shell and decides, on every mount, whether the owner still
 * has something to do before the dashboard is usable. Two independent states,
 * from GET /api/admin/onboarding-status:
 *
 *   !claimed   -> BLOCKING. The PCS has no usable local credential. There is no
 *                 skip button and no close affordance: the box is only reachable
 *                 right now because the operator's SSO let this person in, and
 *                 leaving without setting a credential means depending on that
 *                 forever. Dex is not even offering a Local Account button yet.
 *   !completed -> a dismissible welcome. Cosmetic only.
 *
 * `claimed` is derived host-side from the user database rather than from the
 * marker file, so a restored backup or a migrated PCS cannot end up with the
 * wizard suppressed on a box that has no credential. See onboarding.sh.
 *
 * The wizard is a CONVENIENCE, never the only path: the same operation is
 * `authelia-user-manager.sh claim` over SSH, which is what a FOSS box (whose Dex
 * may legitimately have no connectors at all) uses instead.
 *
 * Failure to reach the endpoint renders children — a status call that 500s or
 * 403s must not lock an otherwise-working dashboard behind a modal.
 */

interface OnboardingStatus {
    claimed: boolean;
    completed: boolean;
    username: string;
}

interface OnboardingResult {
    username: string;
    claimed: boolean;
    completed: boolean;
    password?: string;
}

const DEFAULT_DISPLAYNAME = 'Administrator';

// softTheme's tokens are written for the app's DARK surfaces: `title.small` is
// pure white and `textMuted` is a pale blue. MUI's Dialog paper is white, so
// spreading them here rendered the titles white-on-white (invisible, though
// still in the a11y tree) and the body text at roughly 2:1 contrast. These two
// dialogs are the only place the design system meets a light surface, so the
// light-surface variants live here rather than being added to the shared theme.
const dialogTitleSx = {...title.small, color: colors.textDark};
const dialogBodySx = {fontSize: font.detail, color: 'rgba(10, 39, 63, 0.72)'};

export const OnboardingGate = ({children}: {children: React.ReactNode}) => {
    const [status, setStatus] = useState<OnboardingStatus | null>(null);
    const [checked, setChecked] = useState(false);

    const [username, setUsername] = useState('');
    const [displayname, setDisplayname] = useState(DEFAULT_DISPLAYNAME);
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [generated, setGenerated] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        apiRequest<OnboardingStatus>('/api/admin/onboarding-status')
            .then(s => {
                if (!cancelled) setStatus(s);
            })
            .catch(() => {
                // Unreachable or forbidden — fall through to the app.
                if (!cancelled) setStatus(null);
            })
            .finally(() => {
                if (!cancelled) setChecked(true);
            });
        return () => {
            cancelled = true;
        };
    }, []);

    const submit = useCallback(async () => {
        setError(null);

        if (password !== confirm) {
            setError('Passwords do not match');
            return;
        }

        setSubmitting(true);
        try {
            const result = await apiRequest<OnboardingResult>('/api/admin/onboarding-run', 'POST', {
                username: username.trim(),
                displayname: displayname.trim() || DEFAULT_DISPLAYNAME,
                password,
            });
            // Wipe the plaintext from component state the moment it is no longer
            // needed; the fields are unmounted right after this anyway.
            setPassword('');
            setConfirm('');
            if (result.password) {
                setGenerated(result.password);
            }
            setStatus({claimed: true, completed: true, username: result.username});
        } catch (e: any) {
            setError(e?.message || 'Onboarding failed');
        } finally {
            setSubmitting(false);
        }
    }, [username, displayname, password, confirm]);

    const dismissWelcome = useCallback(async () => {
        try {
            await apiRequest('/api/admin/onboarding-complete', 'POST');
        } catch {
            // Cosmetic marker — a failure here must not trap the user.
        }
        setStatus(prev => (prev ? {...prev, completed: true} : prev));
    }, []);

    if (!checked) {
        return (
            <Backdrop open sx={{backgroundColor: colors.bgApp, zIndex: 2000}}>
                <CircularProgress />
            </Backdrop>
        );
    }

    // No status (endpoint unreachable/forbidden) or nothing to do → app.
    if (!status || (status.claimed && status.completed)) {
        return <>{children}</>;
    }

    // Claimed but never welcomed — dismissible, and the app is live behind it.
    if (status.claimed) {
        return (
            <>
                {children}
                <Dialog open maxWidth="sm" fullWidth onClose={dismissWelcome}>
                    <DialogTitle sx={dialogTitleSx}>Your PCS is ready</DialogTitle>
                    <DialogContent>
                        <Typography sx={dialogBodySx}>
                            You are signed in as <strong>{status.username || 'your account'}</strong>. Local
                            accounts, domains and installed apps are all managed from here.
                        </Typography>
                    </DialogContent>
                    <DialogActions sx={{padding: spacing.cardPadding}}>
                        <Button variant="contained" sx={{...button.primary}} onClick={dismissWelcome}>
                            Get started
                        </Button>
                    </DialogActions>
                </Dialog>
            </>
        );
    }

    // Unclaimed → blocking. No onClose, no skip: this is the whole point.
    return (
        <Dialog open maxWidth="sm" fullWidth disableEscapeKeyDown>
            <DialogTitle sx={dialogTitleSx}>Set up your account</DialogTitle>
            <DialogContent>
                <Stack spacing={2} sx={{marginTop: 1}}>
                    <Typography sx={dialogBodySx}>
                        This server has no local account yet. Choose the username and password you
                        will use to sign in from now on — you can keep using single sign-on as well.
                    </Typography>

                    {generated && (
                        <Alert severity="warning">
                            <Stack direction="row" alignItems="center" spacing={1}>
                                <Box component="code" sx={{fontFamily: 'monospace'}}>{generated}</Box>
                                <Tooltip title="Copy">
                                    <IconButton
                                        size="small"
                                        onClick={() => navigator.clipboard?.writeText(generated)}
                                    >
                                        <ContentCopyIcon fontSize="small" />
                                    </IconButton>
                                </Tooltip>
                            </Stack>
                            This password is shown once.
                        </Alert>
                    )}

                    {error && <Alert severity="error">{error}</Alert>}

                    <TextField
                        label="Username"
                        value={username}
                        onChange={e => setUsername(e.target.value.toLowerCase())}
                        autoFocus
                        fullWidth
                        // The username becomes the OIDC preferred_username that every
                        // app on this PCS keys its per-user account on, so it is
                        // chosen once here and never changed. Say so.
                        helperText="Lowercase letters, digits, - and _. This cannot be changed later."
                    />
                    <TextField
                        label="Display name"
                        value={displayname}
                        onChange={e => setDisplayname(e.target.value)}
                        fullWidth
                    />
                    <TextField
                        label="Password"
                        type="password"
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        fullWidth
                        helperText="At least 8 characters."
                    />
                    <TextField
                        label="Confirm password"
                        type="password"
                        value={confirm}
                        onChange={e => setConfirm(e.target.value)}
                        fullWidth
                    />
                </Stack>
            </DialogContent>
            <DialogActions sx={{padding: spacing.cardPadding}}>
                <Button
                    variant="contained"
                    sx={{...button.primary}}
                    onClick={submit}
                    disabled={submitting || !username || password.length < 8 || !confirm}
                >
                    {submitting ? <CircularProgress size={20} /> : 'Create account'}
                </Button>
            </DialogActions>
        </Dialog>
    );
};
