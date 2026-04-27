import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import {Button} from "@mui/material";
import LinkIcon from "@mui/icons-material/Link";
import React from "react";
import {button, colors, font, spacing} from '@/app/pages/softTheme';

export const BillingPanel = () => {
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
                Billing
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
                Billing is managed from the Yundera Dashboard.
            </Typography>

            <Button
                variant="contained"
                href="https://app.yundera.com/dashboard"
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
                Go to Yundera Dashboard
            </Button>
        </Box>
    );
};
