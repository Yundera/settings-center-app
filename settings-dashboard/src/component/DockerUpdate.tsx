import React, { useState, useEffect } from 'react';
import {
    Button,
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
    Warning as WarningIcon,
    CloudDownload as UpdateIcon,
    Refresh as RefreshIcon
} from "@mui/icons-material";
import { apiRequest } from "@/core/authApi";
import { useNotify } from "react-admin";
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
    const [loading, setLoading] = useState(false);
    const [checking, setChecking] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [updateStatus, setUpdateStatus] = useState<LastUpdateStatus | null>(null);
    const [lastChecked, setLastChecked] = useState<Date | null>(null);
    const notify = useNotify();

    const checkUpdates = async () => {
        setChecking(true);
        setError(null);

        try {
            await apiRequest<LastUpdateStatus>("/api/admin/docker-compose-update-check", "GET");
            await getLastStatus();
        } catch (err: any) {
            setError(err.message || "Failed to check for updates");
        } finally {
            setChecking(false);
        }
    };

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

    const handleUpdate = async () => {
        setLoading(true);
        setError(null);

        try {
            await apiRequest("/api/admin/docker-compose-update-run", "POST");
            notify('Docker update completed successfully');
            await getLastStatus(); // Refresh update status
        } catch (err: any) {
            setError(err.message || "Docker update failed");
        } finally {
            setLoading(false);
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
                {/* Overall Status */}
                {updateStatus && (
                    <Card>
                        <CardContent>
                            <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 2 }}>
                                <Typography variant="h6">Update Status:</Typography>
                                <Chip
                                    label={getOverallStatusText(updateStatus.hasUpdates)}
                                    color={getStatusColor(updateStatus.hasUpdates) as any}
                                    variant="outlined"
                                />
                                {(checking || loading) && (
                                    <Box display="flex" alignItems="center" gap={1}>
                                        <CircularProgress size={16} />
                                        <Typography variant="body2" color="text.secondary">
                                            {loading ? 'Updating...' : 'Checking...'}
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
                                <Typography variant="body2" color="warning.main" sx={{ mt: 1 }}>
                                    {updateStatus.images.filter(img => img.hasUpdate).length} of {updateStatus.images.length} image(s) have updates available
                                </Typography>
                            )}
                        </CardContent>
                    </Card>
                )}

                {/* Individual Image Status */}
                {updateStatus && updateStatus.images.length > 0 && (
                    <Card>
                        <CardContent>
                            <Typography variant="h6" gutterBottom>
                                Image Status ({updateStatus.images.length} images)
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
                        </CardContent>
                    </Card>
                )}

                {/* No Images Found */}
                {updateStatus && updateStatus.images.length === 0 && (
                    <Card>
                        <CardContent>
                            <Stack direction="row" alignItems="center" spacing={2}>
                                <ErrorIcon color="warning" />
                                <Typography variant="body1">
                                    No Docker images found in compose configuration
                                </Typography>
                            </Stack>
                        </CardContent>
                    </Card>
                )}

                {/* Controls */}
                <Card>
                    <CardContent>
                        <Stack direction="row" spacing={2}>
                            {loading || checking ? (
                                <Box display="flex" alignItems="center" gap={1}>
                                    <CircularProgress size={24} />
                                    <Typography>
                                        {loading ? 'Updating Docker images...' : 'Checking for updates...'}
                                    </Typography>
                                </Box>
                            ) : (
                                <>
                                    <Button
                                        variant="outlined"
                                        onClick={checkUpdates}
                                        disabled={checking}
                                        startIcon={<RefreshIcon />}
                                    >
                                        Check for Updates
                                    </Button>

                                    <Button
                                        variant="contained"
                                        color="primary"
                                        onClick={handleUpdate}
                                        disabled={!updateStatus?.hasUpdates || loading}
                                        startIcon={<UpdateIcon />}
                                    >
                                        Update Images
                                    </Button>
                                </>
                            )}
                        </Stack>
                    </CardContent>
                </Card>
            </Stack>
        </div>
    );
};