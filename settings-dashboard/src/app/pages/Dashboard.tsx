import React from 'react';
import Typography from '@mui/material/Typography';
import { PageContainer } from "dashboard-core";
import { YunderaDashboard } from "@/component/YunderaDahsboard";

export const Dashboard: React.FC = () => {
    return (
        <PageContainer>
            <Typography variant="h6" gutterBottom>
                Yundera Dashboard
            </Typography>
            <YunderaDashboard />
        </PageContainer>
    );
};