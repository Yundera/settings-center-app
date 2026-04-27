import React from "react";
import {Typography, Box} from "@mui/material";
import {colors, font, spacing} from '@/app/pages/softTheme';

export const YunderaDashboard: React.FC = () => {
    return (
        <Box sx={{
            backgroundColor: colors.bgPage,
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
                }}
            >
                Manage your domain updates, monitor server health, check PCS status,
                and update core information. We will add more settings over time as we
                continue improving the product. As a startup building a privacy first tool,
                we appreciate your patience.
            </Typography>
        </Box>
    );
};
