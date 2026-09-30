import React, {useEffect, useState} from "react";
import {Alert, Box, Button, Card, CardContent, Chip, CircularProgress, Stack, Typography} from "@mui/material";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import {apiRequest} from "@/core/authApi";
import {button, card, colors, font, spacing, title} from "@/app/pages/softTheme";

/**
 * AccountPanel — "Account" page.
 *
 * Who you are signed in as, and where accounts are managed now. The local
 * accounts (Authelia users) and host SSH access moved to auth-console, the web
 * UI of the auth stack (dex, authelia, auth-registrar) — the panel ships with
 * the state it edits. This card is what is left so that a non-admin, who sees
 * no other panel (see the `permissions` field in App.tsx), still lands
 * somewhere useful.
 */

interface MeUser {
    id: string;
    fullName: string;
    email: string;
    role: string;
}

/**
 * A sibling host, derived from the one this dashboard is served on. The admin
 * app, Authelia and auth-console are routed at parallel `admin-`,
 * `local-auth-` and `auth-console-` labels for the gateway, nip.io and sslip.io
 * variants alike, so swapping the prefix is correct for every deployment shape.
 */
const siblingUrl = (prefix: string): string | null => {
    if (typeof window === "undefined") return null;
    const host = window.location.host;
    const own = "admin-";
    if (!host.startsWith(own)) return null;
    return `https://${prefix}-${host.slice(own.length)}/`;
};

export const AccountPanel = () => {
    const [me, setMe] = useState<MeUser | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        apiRequest<{user: MeUser}>("/api/me")
            .then(data => { if (!cancelled) setMe(data.user); })
            .catch(() => { if (!cancelled) setMe(null); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, []);

    const isAdmin = me?.role === "admin";
    const authUrl = siblingUrl("local-auth");
    const consoleUrl = siblingUrl("auth-console");

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

            <Card sx={card.root}>
                <Box sx={card.header}>
                    <Typography sx={title.small}>Your account</Typography>
                </Box>
                <CardContent sx={card.content}>
                    {loading ? (
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
                                Your password and two-factor settings live in the sign-in portal, which also
                                handles password resets by email. Local accounts and SSH access to this PCS are
                                managed in the Auth Console.
                            </Typography>
                            <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
                                {consoleUrl && (
                                    <Button
                                        startIcon={<OpenInNewIcon/>}
                                        href={consoleUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        sx={button.primary}
                                    >
                                        Open Auth Console
                                    </Button>
                                )}
                                {authUrl && (
                                    <Button
                                        startIcon={<OpenInNewIcon/>}
                                        href={authUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        sx={button.primary}
                                    >
                                        Manage sign-in
                                    </Button>
                                )}
                            </Stack>
                        </Stack>
                    )}
                </CardContent>
            </Card>
        </Box>
    );
};
