import React from 'react';
import Typography from '@mui/material/Typography';
import Link from '@mui/material/Link';
import { PageContainer } from "dashboard-core";
import { YunderaDashboard } from "@/component/YunderaDahsboard";
import { EnvConfiguration} from "@/component/EnvConfiguration";

export const Dashboard: React.FC = () => {
    return (
        <PageContainer>
            <Typography variant="h6" gutterBottom>
                Server parameters
            </Typography>
            <YunderaDashboard />
            <EnvConfiguration />
            <Typography variant="body2" sx={{ mt: 4 }}>
                Need help or support? Join{" "}
                <Link
                    href="https://discord.gg/f2qQUJBHY6"
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    our discord
                </Link>{" "}
                to give us some feedback, or ask any questions to our founders
            </Typography>
        </PageContainer>
    );
};