import React from 'react';
import {YunderaDashboard} from "@/component/YunderaDahsboard";
import {Box} from '@mui/material';
import {spacing} from '@/app/pages/softTheme';

export const Dashboard: React.FC = () => {
    return (
        <Box sx={{
            display: 'flex',
            flexDirection: 'column',
            paddingBottom: spacing.pageY,
        }}>
            <YunderaDashboard />
        </Box>
    );
};
