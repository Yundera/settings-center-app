import React from 'react';
import {PcsWelcome} from "@/component/PcsWelcome";
import {Box} from '@mui/material';
import {spacing} from '@/app/pages/softTheme';

export const Dashboard: React.FC = () => {
    return (
        <Box sx={{
            display: 'flex',
            flexDirection: 'column',
            paddingBottom: spacing.pageY,
        }}>
            <PcsWelcome />
        </Box>
    );
};
