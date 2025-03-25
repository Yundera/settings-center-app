import React from 'react';
import { styled } from '@mui/material/styles';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Grid from '@mui/material/Grid';
import Typography from '@mui/material/Typography';
import { PageContainer } from "dashboard-core";
import { Update } from "@/component/Update";
import { YunderaDashboard } from "@/component/YunderaDahsboard";

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

export const Dashboard: React.FC = () => {
    return (
        <PageContainer>
            <Typography variant="h4" gutterBottom>
                Dashboard Overview
            </Typography>

            <Box sx={{ flexGrow: 1 }}>
                <Grid container spacing={2} direction="column">
                    {/* Second module - Yundera Dashboard */}
                    <Grid item xs={12}>
                        <Item>
                            <Typography variant="h6" gutterBottom>
                                Yundera Dashboard
                            </Typography>
                            <Box sx={{ flexGrow: 1 }}>
                                <YunderaDashboard />
                            </Box>
                        </Item>
                    </Grid>

                    {/* First module - Updates */}
                    <Grid item xs={12}>
                        <Item>
                            <Typography variant="h6" gutterBottom>
                                Updates
                            </Typography>
                            <Box sx={{ flexGrow: 1 }}>
                                <Update />
                            </Box>
                        </Item>
                    </Grid>

                    {/* You can add more grid items following the pattern in your example */}
                    {/* For example:
                    <Grid item xs={12}>
                        <Item>
                            <Typography variant="h6" gutterBottom>
                                Another Module
                            </Typography>
                            <Box sx={{ flexGrow: 1 }}>
                                Content here
                            </Box>
                        </Item>
                    </Grid>
                    <Grid item xs={12}>
                        <Item>
                            <Typography variant="h6" gutterBottom>
                                Yet Another Module
                            </Typography>
                            <Box sx={{ flexGrow: 1 }}>
                                Content here
                            </Box>
                        </Item>
                    </Grid>
                    */}
                </Grid>
            </Box>
        </PageContainer>
    );
};