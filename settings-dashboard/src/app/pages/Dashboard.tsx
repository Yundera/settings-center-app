import React, { useState, useEffect } from 'react';
import { Button, Typography, CircularProgress, Alert, Stack, List, ListItem, ListItemText } from "@mui/material";
import { PageContainer } from "dashboard-core";
import { apiRequest } from "@/core/authApi";

interface ImageUpdate {
  image: string;
  currentDigest: string;
  availableDigest: string;
}

interface UpdateStatus {
  updatesAvailable: boolean;
  images: ImageUpdate[];
}

export const Dashboard: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<boolean>(false);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);

  const checkUpdates = async () => {
    setChecking(true);
    setError(null);

    try {
      const response = await apiRequest<UpdateStatus>("/api/admin/docker-compose-update-check", "GET");
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
    setSuccess(false);

    try {
      await apiRequest("/api/admin/docker-compose-update", "POST");
      setSuccess(true);
      await checkUpdates(); // Refresh update status
    } catch (err: any) {
      setError(err.message || "Update failed");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    checkUpdates();
  }, []);

  return (
    <PageContainer>
      <Typography variant="h4" component="h1" gutterBottom>
        Updates
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }}>Update successful!</Alert>}

      <Stack spacing={2}>
        {updateStatus && (
          <Alert
            severity={updateStatus.updatesAvailable ? "warning" : "success"}
            sx={{ mb: 2 }}
          >
            {updateStatus.updatesAvailable
              ? "Updates available for the following images:"
              : "All images are up to date"}
          </Alert>
        )}

        {updateStatus?.updatesAvailable && (
          <List>
            {updateStatus.images.map((imageUpdate, index) => (
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
          >Check Updates</Button>

          <Button
            variant="contained"
            color="primary"
            onClick={handleUpdate}
            disabled={!updateStatus?.updatesAvailable}
          >Apply Updates</Button></>}
        </Stack>
      </Stack>
    </PageContainer>
  );
};