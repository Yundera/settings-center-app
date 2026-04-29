import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import React from "react";
import {EnvConfiguration} from "@/component/EnvConfiguration";
import {RebootSystem} from "@/component/RebootSystem";
import {colors, font, spacing} from '@/app/pages/softTheme';

export const SystemInformationPanel = () => {
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
                System Information
            </Typography>

            <Box sx={{
                display: 'flex',
                flexDirection: 'column',
                gap: spacing.cardGap,
                maxWidth: '800px',
                width: '100%',
            }}>
                <EnvConfiguration />
                <RebootSystem />
            </Box>
        </Box>
    );
};
