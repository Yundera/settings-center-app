import React from 'react';
import { YunderaDashboard } from "@/component/YunderaDahsboard";
import { EnvConfiguration } from "@/component/EnvConfiguration";
import { Box } from '@mui/material';
import { spacing } from '@/app/pages/softTheme';

/**
 * Dashboard Page — Main landing page after login.
 * Displays the welcome section (YunderaDashboard) and read-only system configuration (EnvConfiguration).
 */
export const Dashboard: React.FC = () => {
    return (
        <Box sx={{
            display: 'flex',
            flexDirection: 'column',
            paddingBottom: spacing.pageY,
        }}>
            {/* Welcome section with link to Yundera Dashboard and intro text */}
            <YunderaDashboard />
            {/* Read-only display of environment config values (domain, IP, etc.) */}
            <EnvConfiguration />
        </Box>
    );
};
