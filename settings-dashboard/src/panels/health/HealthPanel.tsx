import { PageContainer } from "dashboard-core";
import Typography from "@mui/material/Typography";
import React from "react";
import { DockerUpdate } from "@/component/DockerUpdate";
import {SelfCheck} from "@/component/SelfCheck";
import { UpdateChannel } from "@/component/UpdateChannel";

export const HealthPanel = () => {
    return (
        <PageContainer>
            <div style={{ width:"60vw" }}></div>
            <Typography variant="h4" gutterBottom>
                System Health
            </Typography>
            <UpdateChannel />
            <br />
            <DockerUpdate />
            <br />
            <SelfCheck />
        </PageContainer>
    );
};