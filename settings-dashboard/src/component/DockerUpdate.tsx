import React, { useState, useEffect } from 'react';
import { Button, Typography, CircularProgress, Alert, Stack, List, ListItem, ListItemText } from "@mui/material";
import { apiRequest } from "@/core/authApi";
import {useNotify} from "react-admin";
import {LastUpdateStatus} from "@/backend/server/LastUpdateStatus";

export const DockerUpdate: React.FC = () => {
    const [loading, setLoading] = useState(false);
    const [checking, setChecking] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [updateStatus, setUpdateStatus] = useState<LastUpdateStatus | null>(null);
    const notify = useNotify();

    const checkUpdates = async () => {
        setChecking(true);
        setError(null);

        try {
            const response = await apiRequest<LastUpdateStatus>("/api/admin/docker-compose-update-check", "GET");
            setUpdateStatus(response);
        } catch (err: any) {
            setError(err.message || "Failed to check for updates");
        } finally {
            setChecking(false);
        }
    };

    const handleUpdate = async () => {
        setLoading(true);
        setError(null);

        try {
            await apiRequest("/api/admin/docker-compose-update", "POST");
            notify('DockerUpdate successful');
            await checkUpdates(); // Refresh update status
        } catch (err: any) {
            setError(err.message || "DockerUpdate failed");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        checkUpdates();
    }, []);

    return (
        <div>
            <Typography variant="h4" component="h1" gutterBottom>
                Updates
            </Typography>

            {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

            <Stack spacing={2}>
                {updateStatus && (
                    <Alert
                        severity={updateStatus.hasUpdates ? "warning" : "success"}
                        sx={{ mb: 2 }}
                    >
                        {updateStatus.hasUpdates
                            ? "Updates available for the following images:"
                            : "All images are up to date"}
                    </Alert>
                )}

                {updateStatus?.hasUpdates && (
                    <List>
                        {updateStatus.updatesFound.map((imageUpdate, index) => (
                            <ListItem key={index}>
                                <ListItemText
                                    primary={imageUpdate.image}
                                    secondary={
                                        <>
                                            Current: {imageUpdate.currentDigest === 'local-not-found' ? 'Not found locally' : imageUpdate.currentDigest}
                                            <br />
                                            Available: {imageUpdate.availableDigest}
                                        </>
                                    }
                                />
                            </ListItem>
                        ))}
                    </List>
                )}

                <Stack direction="row" spacing={2}>
                    { loading || checking ? <CircularProgress size={24} /> : <>
                        <Button
                            variant="outlined"
                            onClick={checkUpdates}
                            disabled={checking}
                        >Check</Button>

                        <Button
                            variant="contained"
                            color="primary"
                            onClick={handleUpdate}
                            disabled={!updateStatus?.hasUpdates}
                        >Update</Button></>}
                </Stack>
            </Stack>
        </div>
    );
};