import React from 'react';
import {Typography} from "@mui/material";
import {PageContainer} from "dashboard-core";

export const Dashboard: React.FC = () => {
  return (
    <PageContainer>
        <Typography variant="h4" component="h1" gutterBottom>
          Welcome to the Settings panel
        </Typography>
    </PageContainer>
  );
};