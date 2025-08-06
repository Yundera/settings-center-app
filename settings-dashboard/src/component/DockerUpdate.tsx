import React, { useState, useEffect } from 'react';
import {
    Typography,
    CircularProgress,
    Alert,
    Stack,
    List,
    ListItem,
    ListItemText,
    ListItemIcon,
    Chip,
    Card,
    CardContent,
    Box
} from "@mui/material";
import {
    CheckCircle as CheckCircleIcon,
    Error as ErrorIcon,
    Warning as WarningIcon
} from "@mui/icons-material";
import { apiRequest } from "@/core/authApi";
// Updated interface to match new API
interface ImageStatus {
    image: string;
    currentDigest: string;
    availableDigest: string;
    hasUpdate: boolean;
    status: 'up-to-date' | 'update-available' | 'error';
    error?: string;
}

interface LastUpdateStatus {
    timestamp: Date;
    images: ImageStatus[];
    totalImages: number;
    hasUpdates: boolean;
    error?: string;
}

export const DockerUpdate: React.FC = () => {
    const [checking, setChecking] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [updateStatus, setUpdateStatus] = useState<LastUpdateStatus | null>(null);
    const [lastChecked, setLastChecked] = useState<Date | null>(null);


    const getLastStatus = async () => {
        setChecking(true);
        setError(null);

        try {
            const response = await apiRequest<LastUpdateStatus>("/api/admin/docker-compose-status", "GET");
            setUpdateStatus(response);
            setLastChecked(new Date());
        } catch (err: any) {
            setError(err.message || "Failed to check for updates");
        } finally {
            setChecking(false);
        }
    };


    const getStatusColor = (hasUpdates: boolean) => {
        return hasUpdates ? 'warning' : 'success';
    };

    const getImageStatusIcon = (status: string) => {
        switch (status) {
            case 'up-to-date':
                return <CheckCircleIcon color="success" />;
            case 'update-available':
                return <WarningIcon color="warning" />;
            case 'error':
                return <ErrorIcon color="error" />;
            default:
                return <CheckCircleIcon color="disabled" />;
        }
    };

    const getImageStatusChip = (status: string, hasUpdate: boolean) => {
        switch (status) {
            case 'up-to-date':
                return (
                    <Chip
                        label="UP TO DATE"
                        color="success"
                        size="small"
                        variant="outlined"
                    />
                );
            case 'update-available':
                return (
                    <Chip
                        label="UPDATE AVAILABLE"
                        color="warning"
                        size="small"
                        variant="outlined"
                    />
                );
            case 'error':
                return (
                    <Chip
                        label="ERROR"
                        color="error"
                        size="small"
                        variant="outlined"
                    />
                );
            default:
                return (
                    <Chip
                        label="UNKNOWN"
                        color="default"
                        size="small"
                        variant="outlined"
                    />
                );
        }
    };

    const getOverallStatusText = (hasUpdates: boolean) => {
        return hasUpdates ? 'UPDATES AVAILABLE' : 'UP TO DATE';
    };

    useEffect(() => {
        getLastStatus();
    }, []);

    return (
        <div>
            {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

            <Stack spacing={3}>
                {/* Unified Docker Status and Results */}
                <Card>
                    <CardContent>
                        <Stack spacing={3}>
                            {/* Overall Image Status */}
                            {updateStatus && (
                                <>
                                    <Typography variant="h5">Software Status</Typography>
                                    <Stack direction="row" alignItems="center" spacing={2}>
                                        <Typography variant="h6">Status:</Typography>
                                        <Chip
                                            label={getOverallStatusText(updateStatus.hasUpdates)}
                                            color={getStatusColor(updateStatus.hasUpdates) as any}
                                            variant="outlined"
                                        />
                                        {checking && (
                                            <Box display="flex" alignItems="center" gap={1}>
                                                <CircularProgress size={16} />
                                                <Typography variant="body2" color="text.secondary">
                                                    Loading...
                                                </Typography>
                                            </Box>
                                        )}
                                    </Stack>

                                    {lastChecked && (
                                        <Typography variant="body2" color="text.secondary">
                                            Last checked: {lastChecked.toLocaleString()}
                                        </Typography>
                                    )}

                                    {updateStatus.hasUpdates && (
                                        <Typography variant="body2" color="warning.main">
                                            {updateStatus.images.filter(img => img.hasUpdate).length} of {updateStatus.images.length} image(s) have updates available
                                        </Typography>
                                    )}
                                </>
                            )}

                            {/* Individual Image Results */}
                            {updateStatus && updateStatus.images.length > 0 && (
                                <>
                                    <Typography variant="h6" gutterBottom>
                                        Image Details ({updateStatus.images.length} images)
                                    </Typography>
                                    <List dense>
                                        {updateStatus.images.map((imageStatus, index) => (
                                            <ListItem key={index}>
                                                <ListItemIcon>
                                                    {getImageStatusIcon(imageStatus.status)}
                                                </ListItemIcon>
                                                <ListItemText
                                                    primary={
                                                        <Stack direction="row" alignItems="center" spacing={1}>
                                                            <Typography variant="body1">
                                                                {imageStatus.image}
                                                            </Typography>
                                                            {getImageStatusChip(imageStatus.status, imageStatus.hasUpdate)}
                                                        </Stack>
                                                    }
                                                    secondary={
                                                        <Stack spacing={0.5} sx={{ mt: 1 }}>
                                                            {imageStatus.status === 'error' && imageStatus.error ? (
                                                                <Typography variant="body2" color="error.main">
                                                                    <strong>Error:</strong> {imageStatus.error}
                                                                </Typography>
                                                            ) : (
                                                                <>
                                                                    <Typography variant="body2" color="text.secondary">
                                                                        <strong>Current:</strong> {
                                                                        imageStatus.currentDigest === 'local-not-found'
                                                                            ? 'Not found locally'
                                                                            : imageStatus.currentDigest.substring(0, 16) + '...'
                                                                    }
                                                                    </Typography>
                                                                    <Typography variant="body2" color="text.secondary">
                                                                        <strong>Available:</strong> {
                                                                        imageStatus.availableDigest === 'remote-not-found'
                                                                            ? 'Not found remotely'
                                                                            : imageStatus.availableDigest.substring(0, 16) + '...'
                                                                    }
                                                                    </Typography>
                                                                </>
                                                            )}
                                                        </Stack>
                                                    }
                                                />
                                            </ListItem>
                                        ))}
                                    </List>
                                </>
                            )}

                            {/* No Images Found */}
                            {updateStatus && updateStatus.images.length === 0 && (
                                <Stack direction="row" alignItems="center" spacing={2}>
                                    <ErrorIcon color="warning" />
                                    <Typography variant="body1">
                                        No Docker images found in compose configuration
                                    </Typography>
                                </Stack>
                            )}
                        </Stack>
                    </CardContent>
                </Card>
            </Stack>
        </div>
    );
};