import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import {Button} from "@mui/material";
import LinkIcon from "@mui/icons-material/Link";
import React from "react";
import {button, colors, font, spacing} from '@/app/pages/softTheme';

// Authelia hosts the credential-management UI on its own origin so cookies and
// audit logs stay scoped correctly. We deep-link into it from a button rather
// than iframing — Authelia explicitly sets X-Frame-Options to deny embedding.
//
// Derive the auth host from the current admin hostname rather than APP_CONFIG.
// The admin and authelia containers are routed at parallel `admin-${DOMAIN}` /
// `auth-${DOMAIN}` labels (and matching nip.io / sslip.io variants), so swapping
// the prefix is correct for every deployment shape and avoids depending on the
// /api/core/config/core payload (which can be empty when the image is built
// without a baked-in core.env.json).
const buildAutheliaUrl = (): string => {
    if (typeof window === "undefined") return "#";
    const host = window.location.host;
    if (!host.startsWith("admin-")) return "#";
    const authHost = `auth-${host.slice("admin-".length)}`;
    return `https://${authHost}/`;
};

export const AccountPanel = () => {
    const autheliaUrl = buildAutheliaUrl();

    return (
        <Box sx={{
            backgroundColor: colors.bgPage,
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
                Account
            </Typography>

            <Typography
                variant="body2"
                sx={{
                    textAlign: 'center',
                    maxWidth: '600px',
                    lineHeight: 1.6,
                    fontSize: font.caption,
                    fontWeight: 400,
                    color: colors.textWhite,
                    marginBottom: '25px',
                }}
            >
                Change your password, manage two-factor authentication, and review
                active sessions on the Authelia identity provider.
            </Typography>

            <Button
                variant="contained"
                href={autheliaUrl}
                target="_blank"
                rel="noopener noreferrer"
                startIcon={<LinkIcon />}
                sx={{
                    ...button.primary,
                    '&:hover': {
                        ...button.primary['&:hover'],
                        transform: 'translateY(-1px)',
                    },
                }}
            >
                Manage your account
            </Button>
        </Box>
    );
};
