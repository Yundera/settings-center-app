import React from "react";
import {
    Button,
    Typography,
    Box
} from "@mui/material";
import LinkIcon from "@mui/icons-material/Link";
import { colors, font, spacing, button } from '@/app/pages/softTheme';

/**
 * YunderaDashboard — Welcome section displayed at the top of the Dashboard page.
 * Contains a link to the external Yundera Dashboard, a brief product description,
 * and a call-to-action for feedback.
 */
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
            {/* Section title */}
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
                Yundera Dashboard
            </Typography>

            {/* External link to the main Yundera Dashboard app */}
            <Button
                variant="contained"
                href="https://app.yundera.com/dashboard"
                rel="noopener noreferrer"
                startIcon={<LinkIcon />}
                sx={{
                    ...button.primary,
                    marginBottom: '40px',
                    '&:hover': {
                        ...button.primary['&:hover'],
                        transform: 'translateY(-1px)',
                    },
                }}
            >
                Go to Yundera Dashboard
            </Button>

            {/* Subtitle */}
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

            {/* Product description */}
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
                Manage your domain updates, monitor server health, check PCS status,
                and update core information. We will add more settings over time as we
                continue improving the product. As a startup building a privacy first tool,
                we appreciate your patience.
            </Typography>

            {/* Feedback call-to-action */}
            <Typography
                variant="body2"
                sx={{
                    textAlign: 'center',
                    fontSize: font.caption,
                    fontWeight: 700,
                    color: colors.textWhite,
                }}
            >
                Feel free to share feedback and contribute to the project.
            </Typography>
        </Box>
    );
};
