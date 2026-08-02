import React from "react";
import {Typography, Box, Button} from "@mui/material";
import LinkIcon from "@mui/icons-material/Link";
import {button, colors, font, spacing} from '@/app/pages/softTheme';

/**
 * URL of the PCS's own root domain, derived from the hostname this dashboard
 * is being served on.
 *
 * The admin app and the PCS root are routed at parallel labels — `admin-${DOMAIN}`
 * and `${DOMAIN}` — for the gateway, nip.io and sslip.io variants alike, so
 * stripping the prefix is correct for every deployment shape. AccountPanel uses
 * the same trick to find its sibling services.
 *
 * This replaces a read of `window.APP_CONFIG.DOMAIN`, which never resolved:
 * FRONTEND_PUBLIC_ENV publishes only BASE_PATH, so the button below has never
 * rendered in production. Deriving from the host also keeps DOMAIN off the
 * unauthenticated /api/brand payload.
 */
const buildDefaultAppUrl = (): string | null => {
    if (typeof window === "undefined") return null;
    const host = window.location.host;
    const prefix = "admin-";
    if (!host.startsWith(prefix)) return null;
    return `https://${host.slice(prefix.length)}/`;
};

export const PcsWelcome: React.FC = () => {
    const defaultAppUrl = buildDefaultAppUrl();

    return (
        <Box sx={{
            paddingTop: spacing.pageY,
            paddingBottom: '30px',
            paddingX: spacing.pageX,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
        }}>
            <Typography
                variant="h5"
                sx={{
                    textAlign: 'center',
                    fontSize: font.label,
                    fontWeight: 700,
                    color: colors.textWhite,
                    marginBottom: '25px',
                }}
            >
                This is your PCS settings page.
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
                Manage your domain, monitor server health, check PCS status, and update
                core configuration. More settings will be added over time.
            </Typography>

            {defaultAppUrl && (
                <Button
                    variant="contained"
                    href={defaultAppUrl}
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
                    Open your PCS
                </Button>
            )}
        </Box>
    );
};
