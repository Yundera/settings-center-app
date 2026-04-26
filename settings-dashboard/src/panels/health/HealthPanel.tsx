import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import React from "react";
import { DockerUpdate } from "@/component/DockerUpdate";
import { SelfCheck } from "@/component/SelfCheck";
import { UpdateChannel } from "@/component/UpdateChannel";
import { colors, font, spacing } from '@/app/pages/softTheme';

/**
 * Health Panel Page — Accessible via sidebar "Health" menu item.
 * Displays three health-related cards: UpdateChannel, DockerUpdate (Software Status), and SelfCheck (System Status).
 */
export const HealthPanel = () => {
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
            {/* Page-level heading */}
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
                System Health
            </Typography>

            {/* Card stack — each card is spaced by cardGap (50px) */}
            <Box sx={{
                display: 'flex',
                flexDirection: 'column',
                gap: spacing.cardGap,
                maxWidth: '800px',
                width: '100%',
            }}>
                {/* Select update source: stable, dev, local, or custom URL */}
                <UpdateChannel />
                {/* Docker image update status — compares local vs remote digests */}
                <DockerUpdate />
                {/* Self-check script results — runs health verification scripts on the host */}
                <SelfCheck />
            </Box>
        </Box>
    );
};
