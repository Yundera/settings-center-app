import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import {Button} from "@mui/material";
import LinkIcon from "@mui/icons-material/Link";
import React from "react";
import {button, colors, font, spacing} from '@/app/pages/softTheme';
import {useBrand} from '@/core/configuration/brandContext';

/**
 * Links out to whoever manages this PCS.
 *
 * Which "provider" that is depends on two independent things, and the operator
 * always wins (see brandPayload.ts): a Yundera customer whose domain happens to
 * be under nsl.sh is managed and billed by Yundera, so they go to Yundera's
 * dashboard. Only a PCS with no operator at all falls through to the dashboard
 * of the domain zone it sits in.
 *
 * App.tsx omits this panel entirely when brand.provider is null (no operator
 * AND an unrecognised domain zone), so `provider` is non-null whenever this
 * renders. The guard below is belt-and-braces for a direct route hit.
 */
export const ProviderPanel = () => {
    const {provider} = useBrand();

    if (!provider) return null;

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
                {provider.panelLabel}
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
                Your subscription and billing are managed from the {provider.dashboardLabel}.
            </Typography>

            <Button
                variant="contained"
                href={provider.dashboardUrl}
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
                Go to {provider.dashboardLabel}
            </Button>
        </Box>
    );
};
