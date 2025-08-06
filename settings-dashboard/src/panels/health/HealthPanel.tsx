import { PageContainer } from "dashboard-core";
import Typography from "@mui/material/Typography";
import React from "react";
import { DockerUpdate } from "@/component/DockerUpdate";
import {SelfCheck} from "@/component/SelfCheck";

export const HealthPanel = () => {
    return (
        <PageContainer>
            <Typography variant="h4" gutterBottom>
                System Health
            </Typography>
            <DockerUpdate />
            <br />
            <SelfCheck />
        </PageContainer>
    );
};