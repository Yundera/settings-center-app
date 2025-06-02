import { PageContainer } from "dashboard-core";
import Grid from "@mui/material/Grid";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import React from "react";
import { DockerUpdate } from "@/component/DockerUpdate";
import { styled } from '@mui/material/styles';
import Paper from '@mui/material/Paper';
import {SelfCheck} from "@/component/SelfCheck";

// Styled Item component for consistent styling across grid items
const Item = styled(Paper)(({ theme }) => ({
    backgroundColor: '#fff',
    ...theme.typography.body2,
    padding: theme.spacing(2),
    color: theme.palette.text.secondary,
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    ...theme.applyStyles?.('dark', {
        backgroundColor: '#1A2027',
    }),
}));

export const HealthPanel = () => {
    return (
        <PageContainer>
            <Typography variant="h6" gutterBottom>
                Updates
            </Typography>
            <DockerUpdate />
            <SelfCheck />
        </PageContainer>
    );
};