import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import {Button} from "@mui/material";
import LinkIcon from "@mui/icons-material/Link";
import React from "react";
import {button, colors, font, spacing} from '@/app/pages/softTheme';
import {useBrand} from '@/core/configuration/brandContext';

/**
 * Links out to whoever operates this PCS.
 *
 * Deliberately says nothing about what lives behind that link. Subscriptions,
 * invoices, VM controls or none of the above are the operator's business — an
 * operator that bills and one that doesn't must render the same surface here,
 * which is why this panel is a name, a label and a URL, all from brand.json.
 *
 * Which operator that is depends on two independent things, and the configured
 * operator always wins (see brandPayload.ts): a Yundera customer whose domain
 * happens to sit under nsl.sh is operated by Yundera, so they go to Yundera's
 * dashboard. Only a PCS with no operator at all falls through to the dashboard
 * of the domain zone it sits in.
 *
 * App.tsx omits this panel entirely when brand.operator is null (no operator
 * AND an unrecognised domain zone), so `operator` is non-null whenever this
 * renders. The guard below is belt-and-braces for a direct route hit.
 */
export const OperatorPanel = () => {
    const {operator} = useBrand();

    if (!operator) return null;

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
                {operator.panelLabel}
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
                This server is managed by {operator.name}. Manage it from the {operator.dashboardLabel}.
            </Typography>

            <Button
                variant="contained"
                href={operator.dashboardUrl}
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
                Go to {operator.dashboardLabel}
            </Button>
        </Box>
    );
};
