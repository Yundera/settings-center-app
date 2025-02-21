import React from "react";
import Button from "@mui/material/Button";
import { styled } from "@mui/material/styles";
import LinkIcon from "@mui/icons-material/Link";

// Optional styling for the button
const StyledButton = styled(Button)(({ theme }) => ({
    margin: theme.spacing(1),
}));

export const YunderaDashboard: React.FC = () => {
    return (
        <div>
            <h1>Yundera Dashboard</h1>

            <StyledButton
                variant="contained"
                color="primary"
                href="https://app.yundera.com/dashboard"
                rel="noopener noreferrer"
                startIcon={<LinkIcon />}
            >
                Go to Yundera Dashboard
            </StyledButton>
        </div>
    );
}