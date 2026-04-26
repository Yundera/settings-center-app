import React, { useState, useEffect } from 'react';
import {
    Button,
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
import { useNotify } from "react-admin";
import { SelfCheckStatus, SelfCheckResult } from "@/backend/server/SelfCheck/SelfCheckTypes";
import { colors, font, spacing, card, title, button, chip, icon, text } from '@/app/pages/softTheme';

/**
 * SelfCheck — Displays the "System Status" card on the Health page.
 * Fetches self-check script results from the backend and shows pass/fail
 * status for each script. Supports manual re-run via "Run Self-Check" button.
 * Auto-polls every 2 seconds while a check is running.
 */
export const SelfCheck: React.FC = () => {
    const [loading, setLoading] = useState(false);
    const [checking, setChecking] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [status, setStatus] = useState<SelfCheckStatus | null>(null);
    const notify = useNotify();

    // Fetch the latest self-check status from the backend
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

    // Trigger a new self-check run on the backend, then refresh status
    const handleRunSelfCheck = async () => {
        setLoading(true);
        setError(null);

        try {
            await apiRequest("/api/admin/self-check-run", "POST");
            notify('Self-check completed successfully');
            await checkStatus();
        } catch (err: any) {
            setError(err.message || "Self-check failed");
        } finally {
            setLoading(false);
        }
    };

    // Map overall status to a semantic color for the status chip
    const getStatusHexColor = (overallStatus: string) => {
        switch (overallStatus) {
            case 'success': return colors.statusSuccessChip;
            case 'failure': return colors.statusErrorAlt;
            case 'partial': return colors.statusWarning;
            case 'never_run': return colors.statusInfo;
            default: return '#bdbdbd';
        }
    };

    // Returns a green check or red error icon based on script success
    const getStatusIcon = (success: boolean) => {
        return success ? (
            <CheckCircleIcon sx={{ color: colors.statusSuccess, ...icon.size }} />
        ) : (
            <ErrorIcon sx={{ color: colors.statusError, ...icon.size }} />
        );
    };

    const formatDuration = (duration?: number) => {
        if (!duration) return '';
        return duration < 1000 ? `${duration}ms` : `${(duration / 1000).toFixed(1)}s`;
    };

    // Poll status on mount; auto-refresh every 2s while a check is running
    useEffect(() => {
        checkStatus();
        const interval = setInterval(() => {
            if (status?.isRunning) { checkStatus(); }
        }, 2000);
        return () => clearInterval(interval);
    }, [status?.isRunning]);

    return (
        <div>
            {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

            <Stack spacing={3}>
                <Card sx={card.root}>
                    <Box sx={card.header}>
                        <Typography sx={title.small}>
                            System Status
                        </Typography>
                    </Box>

                    <CardContent sx={card.content}>
                        <Stack sx={{ gap: spacing.itemGap }}>
                            <Stack direction="row" alignItems="center" spacing={2} justifyContent="space-between">
                                <Stack direction="row" alignItems="center" spacing={2}>
                                    <Typography sx={text.label}>Status:</Typography>
                                    {status && (
                                        <Chip
                                            label={status.overallStatus.replace('_', ' ').toUpperCase()}
                                            variant="outlined"
                                            sx={{
                                                ...chip.status,
                                                border: `1px solid ${getStatusHexColor(status.overallStatus)} !important`,
                                                color: `${getStatusHexColor(status.overallStatus)} !important`,
                                                '& .MuiChip-label': { color: `${getStatusHexColor(status.overallStatus)} !important` },
                                            }}
                                        />
                                    )}
                                    {status?.isRunning && (
                                        <Box display="flex" alignItems="center" gap={1}>
                                            <CircularProgress size={16} />
                                            <Typography variant="body2" sx={{ color: colors.textWhite }}>
                                                Running...
                                            </Typography>
                                        </Box>
                                    )}
                                </Stack>

                                {loading || checking || status?.isRunning ? (
                                    <Box display="flex" alignItems="center" gap={1}>
                                        <CircularProgress size={24} />
                                        <Typography sx={{ color: colors.textWhite }}>
                                            {status?.isRunning ? 'Running...' : 'Loading...'}
                                        </Typography>
                                    </Box>
                                ) : (
                                    <Button
                                        variant="contained"
                                        onClick={handleRunSelfCheck}
                                        disabled={loading || status?.isRunning}
                                        sx={button.primary}
                                    >
                                        Run Self-Check
                                    </Button>
                                )}
                            </Stack>

                            {status?.lastRun && (
                                <Typography variant="body2" sx={text.detail}>
                                    Last run: {new Date(status.lastRun).toLocaleString()}
                                </Typography>
                            )}

                            {status?.connectionError && (
                                <Alert severity="error" sx={{ whiteSpace: 'pre-wrap' }}>
                                    <Typography variant="subtitle2" gutterBottom>
                                        Host Connection Error
                                    </Typography>
                                    {status.connectionError}
                                </Alert>
                            )}

                            {status && Object.keys(status.scripts).length > 0 && (
                                <Box>
                                    {Object.entries(status.scripts).map(([scriptName, result], index, arr) => (
                                        <Box
                                            key={scriptName}
                                            sx={{
                                                display: 'flex',
                                                flexDirection: 'row',
                                                alignItems: 'center',
                                                mb: index < arr.length - 1 ? spacing.itemGap : 0,
                                            }}
                                        >
                                            <Box sx={icon.container}>
                                                {getStatusIcon(result.success)}
                                            </Box>
                                            <Box>
                                                <Typography sx={text.label}>{scriptName}</Typography>
                                                <Stack direction="row" alignItems="center" spacing={1}>
                                                    <Typography variant="body2" sx={text.detail}>
                                                        {result.message}
                                                    </Typography>
                                                    {result.duration && (
                                                        <Chip
                                                            label={formatDuration(result.duration)}
                                                            size="small"
                                                            variant="outlined"
                                                            sx={{
                                                                color: `${colors.textWhite} !important`,
                                                                border: `1px solid ${colors.textWhite} !important`,
                                                                fontSize: font.caption,
                                                                fontWeight: 400,
                                                                letterSpacing: '0.75px',
                                                                borderRadius: '12px',
                                                                backgroundColor: 'transparent',
                                                            }}
                                                        />
                                                    )}
                                                </Stack>
                                            </Box>
                                        </Box>
                                    ))}
                                </Box>
                            )}
                        </Stack>
                    </CardContent>
                </Card>
            </Stack>
        </div>
    );
};
