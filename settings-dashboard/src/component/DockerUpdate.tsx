import React, { useState, useEffect } from 'react';
import {
    Typography,
    CircularProgress,
    Alert,
    Stack,
    Chip,
    Card,
    CardContent,
    Box
} from "@mui/material";
import {
    CheckCircle as CheckCircleIcon,
    Error as ErrorIcon
} from "@mui/icons-material";
import { apiRequest } from "@/core/authApi";
import { colors, font, spacing, card, title, chip, icon, text } from '@/app/pages/softTheme';

// Status of a single Docker image (local vs remote digest comparison)
interface ImageStatus {
    image: string;
    currentDigest: string;
    availableDigest: string;
    hasUpdate: boolean;
    status: 'up-to-date' | 'update-available' | 'error';
    error?: string;
}

// Aggregated status from the docker-compose-status API endpoint
interface LastUpdateStatus {
    timestamp: Date;
    images: ImageStatus[];
    totalImages: number;
    hasUpdates: boolean;
    error?: string;
}

/**
 * DockerUpdate — Displays the "Software Status" card on the Health page.
 * Fetches Docker image statuses from the backend and shows whether each image
 * is up-to-date, has an update available, or encountered an error.
 * Each image row shows a status icon, image name, status chip, and digest info.
 */
export const DockerUpdate: React.FC = () => {
    const [checking, setChecking] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [updateStatus, setUpdateStatus] = useState<LastUpdateStatus | null>(null);
    const [lastChecked, setLastChecked] = useState<Date | null>(null);

    // Fetch Docker image status from backend on mount
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

    // Returns a colored icon based on the image status
    const getImageStatusIcon = (status: string) => {
        switch (status) {
            case 'up-to-date':
                return <CheckCircleIcon sx={{ color: colors.statusSuccess, ...icon.size }} />;
            case 'update-available':
                return <ErrorIcon sx={{ color: colors.statusWarningAlt, ...icon.size }} />;
            case 'error':
                return <ErrorIcon sx={{ color: colors.statusError, ...icon.size }} />;
            default:
                return <CheckCircleIcon color="disabled" sx={icon.size} />;
        }
    };

    // Returns a colored outlined chip for per-image status (uses !important to override MUI theme defaults)
    const getImageStatusChip = (status: string, hasUpdate: boolean) => {
        switch (status) {
            case 'up-to-date':
                return (
                    <Chip
                        label="UP TO DATE"
                        size="small"
                        variant="outlined"
                        sx={{ ...chip.tag, border: `1px solid ${colors.statusSuccess} !important`, color: `${colors.statusSuccess} !important`, '& .MuiChip-label': { color: `${colors.statusSuccess} !important` } }}
                    />
                );
            case 'update-available':
                return (
                    <Chip
                        label="IN PROGRESS"
                        size="small"
                        variant="outlined"
                        sx={{ ...chip.tag, border: `1px solid ${colors.statusWarningAlt} !important`, color: `${colors.statusWarningAlt} !important`, '& .MuiChip-label': { color: `${colors.statusWarningAlt} !important` } }}
                    />
                );
            case 'error':
                return (
                    <Chip
                        label="ERROR"
                        size="small"
                        variant="outlined"
                        sx={{ ...chip.tag, border: `1px solid ${colors.statusError} !important`, color: `${colors.statusError} !important`, '& .MuiChip-label': { color: `${colors.statusError} !important` } }}
                    />
                );
            default:
                return (
                    <Chip
                        label="UNKNOWN"
                        size="small"
                        variant="outlined"
                        sx={{ ...chip.tag, border: `1px solid #bdbdbd !important`, color: `#bdbdbd !important`, '& .MuiChip-label': { color: `#bdbdbd !important` } }}
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
                <Card sx={card.root}>
                    <Box sx={card.header}>
                        <Typography sx={title.small}>
                            Software Status
                        </Typography>
                    </Box>

                    <CardContent sx={card.content}>
                        <Stack sx={{ gap: spacing.itemGap }}>
                            {updateStatus && (
                                <>
                                    <Stack direction="row" alignItems="center" spacing={2}>
                                        <Typography sx={text.label}>Status:</Typography>
                                        <Chip
                                            label={getOverallStatusText(updateStatus.hasUpdates)}
                                            variant="outlined"
                                            sx={{
                                                ...chip.status,
                                                border: `1px solid ${updateStatus.hasUpdates ? colors.statusWarning : colors.statusSuccessChip} !important`,
                                                color: `${updateStatus.hasUpdates ? colors.statusWarning : colors.statusSuccessChip} !important`,
                                                '& .MuiChip-label': { color: `${updateStatus.hasUpdates ? colors.statusWarning : colors.statusSuccessChip} !important` },
                                            }}
                                        />
                                        {checking && (
                                            <Box display="flex" alignItems="center" gap={1}>
                                                <CircularProgress size={16} />
                                                <Typography variant="body2" sx={{ color: colors.textWhite }}>
                                                    Loading...
                                                </Typography>
                                            </Box>
                                        )}
                                    </Stack>

                                    {lastChecked && (
                                        <Typography variant="body2" sx={text.detail}>
                                            Last checked: {lastChecked.toLocaleString()}
                                        </Typography>
                                    )}

                                    {updateStatus.hasUpdates && (
                                        <Typography variant="body2" sx={{ ...text.detail, color: colors.textWhite }}>
                                            {updateStatus.images.filter(img => img.hasUpdate).length} of {updateStatus.images.length} image(s) have updates available
                                        </Typography>
                                    )}
                                </>
                            )}

                            {updateStatus && updateStatus.images.length > 0 && (
                                <Box>
                                    {updateStatus.images.map((imageStatus, index) => (
                                        <Box
                                            key={index}
                                            sx={{
                                                display: 'flex',
                                                flexDirection: 'row',
                                                alignItems: 'center',
                                                mb: index < updateStatus.images.length - 1 ? spacing.itemGap : 0,
                                            }}
                                        >
                                            <Box sx={icon.container}>
                                                {getImageStatusIcon(imageStatus.status)}
                                            </Box>
                                            <Box>
                                                <Stack direction="row" alignItems="center" spacing={1}>
                                                    <Typography sx={text.label}>
                                                        {imageStatus.image}
                                                    </Typography>
                                                    {getImageStatusChip(imageStatus.status, imageStatus.hasUpdate)}
                                                </Stack>
                                                <Box sx={{ mt: '4px' }}>
                                                    {imageStatus.status === 'error' && imageStatus.error ? (
                                                        <Typography variant="body2" sx={{ ...text.detail, color: colors.statusError }}>
                                                            Error: {imageStatus.error}
                                                        </Typography>
                                                    ) : (
                                                        <>
                                                            <Typography variant="body2" sx={text.detail}>
                                                                Current: {imageStatus.currentDigest === 'local-not-found'
                                                                    ? 'Not found locally'
                                                                    : imageStatus.currentDigest.substring(0, 16) + '...'}
                                                            </Typography>
                                                            <Typography variant="body2" sx={text.detail}>
                                                                Available: {imageStatus.availableDigest === 'remote-not-found'
                                                                    ? 'Not found remotely'
                                                                    : imageStatus.availableDigest.substring(0, 16) + '...'}
                                                            </Typography>
                                                        </>
                                                    )}
                                                </Box>
                                            </Box>
                                        </Box>
                                    ))}
                                </Box>
                            )}

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
