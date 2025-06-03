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
    Schedule as ScheduleIcon
} from "@mui/icons-material";
import { PageContainer } from "dashboard-core";
import { apiRequest } from "@/core/authApi";
import { useNotify } from "react-admin";
import { SelfCheckStatus, SelfCheckResult } from "@/backend/server/SelfCheckTypes";

export const SelfCheck: React.FC = () => {
    const [loading, setLoading] = useState(false);
    const [checking, setChecking] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [status, setStatus] = useState<SelfCheckStatus | null>(null);
    const notify = useNotify();

    const checkStatus = async () => {
        setChecking(true);
        setError(null);

        try {
            const response = await apiRequest<SelfCheckStatus>("/api/admin/self-check-status", "GET");
            setStatus(response);
        } catch (err: any) {
            setError(err.message || "Failed to get self-check status");
        } finally {
            setChecking(false);
        }
    };

    const handleRunSelfCheck = async () => {
        setLoading(true);
        setError(null);

        try {
            await apiRequest("/api/admin/self-check-run", "POST");
            notify('Self-check completed successfully');
            await checkStatus(); // Refresh status
        } catch (err: any) {
            setError(err.message || "Self-check failed");
        } finally {
            setLoading(false);
        }
    };

    const getStatusColor = (overallStatus: string) => {
        switch (overallStatus) {
            case 'success': return 'success';
            case 'failure': return 'error';
            case 'partial': return 'warning';
            case 'never_run': return 'info';
            default: return 'default';
        }
    };

    const getStatusIcon = (success: boolean) => {
        return success ? (
            <CheckCircleIcon color="success" />
        ) : (
            <ErrorIcon color="error" />
        );
    };

    const formatDuration = (duration?: number) => {
        if (!duration) return '';
        return duration < 1000 ? `${duration}ms` : `${(duration / 1000).toFixed(1)}s`;
    };

    useEffect(() => {
        checkStatus();
        // Set up polling to check if self-check is running
        const interval = setInterval(() => {
            if (status?.isRunning) {
                checkStatus();
            }
        }, 2000);

        return () => clearInterval(interval);
    }, [status?.isRunning]);

    return (
        <div>
            {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

            <Stack spacing={3}>
                {/* Overall Status */}
                {status && (
                    <Card>
                        <CardContent>
                            <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 2 }}>
                                <Typography variant="h6">Overall Status:</Typography>
                                <Chip
                                    label={status.overallStatus.replace('_', ' ').toUpperCase()}
                                    color={getStatusColor(status.overallStatus) as any}
                                    variant="outlined"
                                />
                                {status.isRunning && (
                                    <Box display="flex" alignItems="center" gap={1}>
                                        <CircularProgress size={16} />
                                        <Typography variant="body2" color="text.secondary">
                                            Running...
                                        </Typography>
                                    </Box>
                                )}
                            </Stack>

                            {status.lastRun && (
                                <Typography variant="body2" color="text.secondary">
                                    Last run: {new Date(status.lastRun).toLocaleString()}
                                </Typography>
                            )}
                        </CardContent>
                    </Card>
                )}

                {/* Script Results */}
                {status && Object.keys(status.scripts).length > 0 && (
                    <Card>
                        <CardContent>
                            <Typography variant="h6" gutterBottom>
                                Script Results
                            </Typography>
                            <List dense>
                                {Object.entries(status.scripts).map(([scriptName, result]) => (
                                    <ListItem key={scriptName}>
                                        <ListItemIcon>
                                            {getStatusIcon(result.success)}
                                        </ListItemIcon>
                                        <ListItemText
                                            primary={scriptName}
                                            secondary={
                                                <Stack direction="row" alignItems="center" spacing={1}>
                                                    <Typography variant="body2">
                                                        {result.message}
                                                    </Typography>
                                                    {result.duration && (
                                                        <Chip
                                                            label={formatDuration(result.duration)}
                                                            size="small"
                                                            variant="outlined"
                                                        />
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

                {/* Integrity Check Results */}
                {status?.integrityCheck && (
                    <Card>
                        <CardContent>
                            <Typography variant="h6" gutterBottom>
                                File Integrity Check
                            </Typography>
                            <Stack direction="row" alignItems="center" spacing={2}>
                                {getStatusIcon(status.integrityCheck.success)}
                                <Typography variant="body1">
                                    {status.integrityCheck.message}
                                </Typography>
                                {status.integrityCheck.duration && (
                                    <Chip
                                        label={formatDuration(status.integrityCheck.duration)}
                                        size="small"
                                        variant="outlined"
                                    />
                                )}
                            </Stack>
                            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                                {new Date(status.integrityCheck.timestamp).toLocaleString()}
                            </Typography>
                        </CardContent>
                    </Card>
                )}

                {/* Controls */}
                <Card>
                    <CardContent>
                        <Stack direction="row" spacing={2}>
                            {loading || checking || status?.isRunning ? (
                                <Box display="flex" alignItems="center" gap={1}>
                                    <CircularProgress size={24} />
                                    <Typography>
                                        {status?.isRunning ? 'Self-check running...' : 'Loading...'}
                                    </Typography>
                                </Box>
                            ) : (
                                <>
                                    <Button
                                        variant="outlined"
                                        onClick={checkStatus}
                                        disabled={checking}
                                    >
                                        Refresh Status
                                    </Button>

                                    <Button
                                        variant="contained"
                                        color="primary"
                                        onClick={handleRunSelfCheck}
                                        disabled={loading || status?.isRunning}
                                    >
                                        Run Self-Check
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