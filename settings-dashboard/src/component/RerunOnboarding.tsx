import React, {useEffect, useState} from 'react';
import {
    Alert,
    Box,
    Button,
    Card,
    CardContent,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Stack,
    TextField,
    Typography,
} from "@mui/material";
import {RestartAlt} from "@mui/icons-material";
import {apiRequest} from "@/core/authApi";
import {useNotify} from "react-admin";
import {button, card, colors, font, text, title} from '@/app/pages/softTheme';

interface OnboardingStatus {
    claimed: boolean;
    completed: boolean;
    username: string;
}

interface OnboardingResetResponse extends OnboardingStatus {
    backup: string;
    warning?: string;
}

// Typed into the confirmation field before the reset button unlocks. The host
// script guards itself with a mandatory `--confirm` flag for the same reason:
// this disables every local account on the PCS.
const RESET_CONFIRM_WORD = "reset";

// softTheme's title/text tokens are dark-surface only and vanish on MUI's white
// Dialog paper — same local fix as OnboardingGate.
const dialogTitleSx = {...title.small, color: colors.textDark};
const dialogBodySx = {fontSize: font.detail, color: 'rgba(10, 39, 63, 0.72)'};

/**
 * RerunOnboarding — "Re-run onboarding": unclaims the PCS so the first-start
 * wizard (OnboardingGate) replays. It lives here, next to the wizard it
 * replays, and not in auth-console, which has no claim flow.
 *
 * Hidden when the status call fails (a box without onboarding.sh). The route
 * refuses while Yundera Login is off — after the reset it is the only way back
 * to the wizard — and keeps the caller signed in while ending every other
 * session on this app.
 */
export const RerunOnboarding: React.FC = () => {
    const notify = useNotify();
    const [status, setStatus] = useState<OnboardingStatus | null>(null);
    const [unavailable, setUnavailable] = useState(false);
    const [open, setOpen] = useState(false);
    const [word, setWord] = useState("");
    const [resetting, setResetting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        apiRequest<OnboardingStatus>("/api/admin/onboarding-status")
            .then(s => { if (!cancelled) setStatus(s); })
            .catch(() => { if (!cancelled) setUnavailable(true); });
        return () => { cancelled = true; };
    }, []);

    const submit = async () => {
        setResetting(true);
        setError(null);
        try {
            const res = await apiRequest<OnboardingResetResponse>("/api/admin/onboarding-reset", "POST", {confirm: true});
            notify(`Onboarding reset. Previous accounts backed up to ${res.backup}`, {type: "info", autoHideDuration: 10000});
            if (res.warning) notify(res.warning, {type: "warning", autoHideDuration: 10000});
            // The box is unclaimed now: reloading lets OnboardingGate take over.
            window.location.reload();
        } catch (err: any) {
            setError(err?.message || "Failed to reset onboarding");
            setResetting(false);
        }
    };

    if (unavailable) return null;

    return (
        <Card sx={card.root}>
            <Box sx={card.header}>
                <Typography sx={title.small}>Onboarding</Typography>
            </Box>
            <CardContent sx={card.content}>
                <Stack spacing={2}>
                    <Typography variant="body2" sx={text.detail}>
                        The first-start wizard runs once, when this server has no local account yet.
                        Re-running it puts the server back into that state so the owner account can be
                        created again from scratch.
                    </Typography>
                    {status && (
                        <Typography variant="body2" sx={text.detail}>
                            Currently <strong>{status.claimed ? "claimed" : "unclaimed"}</strong>
                            {status.claimed && status.username ? <> by <strong>{status.username}</strong></> : null}.
                        </Typography>
                    )}
                    <Box>
                        <Button
                            variant="contained"
                            color="error"
                            startIcon={<RestartAlt/>}
                            onClick={() => { setWord(""); setError(null); setOpen(true); }}
                            disabled={!status}
                            sx={{...button.primary, backgroundColor: colors.statusErrorAlt}}
                        >
                            Re-run onboarding
                        </Button>
                    </Box>
                </Stack>
            </CardContent>

            <Dialog open={open} onClose={() => !resetting && setOpen(false)} fullWidth maxWidth="sm">
                <DialogTitle sx={dialogTitleSx}>Re-run onboarding</DialogTitle>
                <DialogContent>
                    <Stack spacing={2} sx={{mt: 1}}>
                        <Alert severity="error">
                            Every local account on this PCS is disabled and the setup wizard runs again on
                            the next page load. Every other session on this admin app is signed out.
                        </Alert>
                        <Typography sx={dialogBodySx}>
                            Password hashes are copied to a timestamped backup beside the account database.
                            While the server is unclaimed the &ldquo;Local Account&rdquo; sign-in option
                            disappears, so single sign-on (Yundera Login) is the way back in — the reset is
                            refused if it is off.
                        </Typography>
                        {error && <Alert severity="warning">{error}</Alert>}
                        <TextField
                            label={`Type "${RESET_CONFIRM_WORD}" to confirm`}
                            value={word}
                            size="small"
                            fullWidth
                            autoFocus
                            onChange={e => setWord(e.target.value)}
                        />
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setOpen(false)} disabled={resetting}>Cancel</Button>
                    <Button
                        onClick={() => void submit()}
                        disabled={resetting || word.trim().toLowerCase() !== RESET_CONFIRM_WORD}
                        sx={{...button.primary, backgroundColor: colors.statusErrorAlt}}
                    >
                        {resetting ? "Resetting…" : "Re-run onboarding"}
                    </Button>
                </DialogActions>
            </Dialog>
        </Card>
    );
};
