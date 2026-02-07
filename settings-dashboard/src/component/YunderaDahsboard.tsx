import React from "react";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import Link from "@mui/material/Link";
import { styled } from "@mui/material/styles";
import LinkIcon from "@mui/icons-material/Link";

// Optional styling for the button
const StyledButton = styled(Button)(({ theme }) => ({
    margin: theme.spacing(1),
}));

export const YunderaDashboard: React.FC = () => {
    return (
        <div>
            <Typography variant="body1" gutterBottom sx={{ color: 'grey.700', fontStyle: 'italic' }}>
                Manage your subscription, Change your billing or rename your domain?
            </Typography>

            <StyledButton
                variant="contained"
                color="primary"
                href="https://app.yundera.com/dashboard"
                rel="noopener noreferrer"
                startIcon={<LinkIcon />}
            >
                Click here
            </StyledButton>
        </div>
    );
}
