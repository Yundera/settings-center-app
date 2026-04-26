import React, { useState, useEffect } from 'react';
import {
    Card,
    CardContent,
    Typography,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    TextField,
    Button,
    Stack,
    Alert,
    CircularProgress,
    Box
} from "@mui/material";
import { useNotify } from "react-admin";
import { apiRequest } from "@/core/authApi";
import { colors, font, card, title, button, text } from '@/app/pages/softTheme';

// Available update channel types: stable (default), dev (main branch), local, or custom URL
export type UpdateChannelType = 'stable' | 'dev' | 'local' | 'custom';

interface UpdateChannelConfig {
    channel: UpdateChannelType;
    customUrl?: string;
}

/**
 * UpdateChannel — Allows the admin to select and save the PCS update source.
 * Channels: stable (empty URL), dev (GitHub main branch), local, or custom URL.
 * After saving, automatically triggers a self-check run.
 */
export const UpdateChannel: React.FC = () => {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [config, setConfig] = useState<UpdateChannelConfig>({
        channel: 'stable',
        customUrl: ''
    });
    const [customUrl, setCustomUrl] = useState('');
    const notify = useNotify();

    // Fetch the current update channel config from the backend and map URL to channel type
    const loadCurrentConfig = async () => {
        try {
            const response = await apiRequest<{ updateUrl: string | null }>("/api/admin/update-channel", "GET");
            const updateUrl = response.updateUrl;

            if (!updateUrl || updateUrl === '') {
                setConfig({ channel: 'stable' });
            } else if (updateUrl === 'local') {
                setConfig({ channel: 'local' });
            } else if (updateUrl === 'https://github.com/Yundera/template-root/archive/refs/heads/main.zip') {
                setConfig({ channel: 'dev' });
            } else {
                setConfig({ channel: 'custom', customUrl: updateUrl });
                setCustomUrl(updateUrl);
            }
        } catch (err: any) {
            setError(err.message || "Failed to load update channel configuration");
        }
    };

    const handleChannelChange = (channel: UpdateChannelType) => {
        setConfig(prev => ({ ...prev, channel }));
        setError(null);
    };

    const handleCustomUrlChange = (url: string) => {
        setCustomUrl(url);
        setConfig(prev => ({ ...prev, customUrl: url }));
    };

    // Convert selected channel type to the actual URL sent to the backend
    const getUpdateUrl = (): string => {
        switch (config.channel) {
            case 'local':
                return 'local';
            case 'dev':
                return 'https://github.com/Yundera/template-root/archive/refs/heads/main.zip';
            case 'custom':
                return customUrl;
            case 'stable':
            default:
                return '';
        }
    };

    // Save the selected channel to backend, then trigger a self-check
    const handleSaveChannel = async () => {
        setLoading(true);
        setError(null);

        if (config.channel === 'custom' && !customUrl.trim()) {
            setError('Custom URL is required when using custom channel');
            setLoading(false);
            return;
        }

        try {
            const updateUrl = getUpdateUrl();
            await apiRequest("/api/admin/update-channel", "POST", {
                updateUrl
            });

            notify('Update channel saved successfully. Running self-check...');

            await apiRequest("/api/admin/self-check-run", "POST");
            notify('Self-check completed successfully');

        } catch (err: any) {
            setError(err.message || "Failed to save update channel");
        } finally {
            setLoading(false);
        }
    };

    // Human-readable description for each channel option
    const getChannelDescription = (channel: UpdateChannelType): string => {
        switch (channel) {
            case 'stable':
                return 'Default stable channel (recommended)';
            case 'dev':
                return 'Development channel with latest features';
            case 'local':
                return 'Local development mode';
            case 'custom':
                return 'Custom repository URL';
            default:
                return '';
        }
    };

    // Load current config on mount
    useEffect(() => {
        loadCurrentConfig();
    }, []);

    return (
        <Card sx={card.root}>
            <Box sx={card.header}>
                <Typography sx={title.small}>
                    Update Channel
                </Typography>
            </Box>

            <CardContent sx={card.content}>
                <Stack spacing={0}>

                    {error && <Alert severity="error" sx={{ mb: '30px' }}>{error}</Alert>}

                    <FormControl fullWidth sx={{ mb: '30px' }}>
                        <InputLabel sx={{ fontSize: font.caption, fontWeight: 300, color: colors.textMuted, '&.Mui-focused': { color: colors.textMuted } }}>Channel</InputLabel>
                        <Select
                            value={config.channel}
                            label="Channel"
                            onChange={(e) => handleChannelChange(e.target.value as UpdateChannelType)}
                            disabled={loading}
                            sx={{
                                color: colors.textWhite,
                                '& .MuiOutlinedInput-notchedOutline': { borderColor: colors.textMuted },
                                '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: colors.textMuted },
                                '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: colors.textMuted },
                                '& .MuiSvgIcon-root': { color: colors.textMuted },
                            }}
                        >
                            <MenuItem value="stable">
                                <Stack>
                                    <Typography sx={{ fontSize: font.label, fontWeight: 400, color: colors.textWhite }}>Stable</Typography>
                                    <Typography sx={{ fontSize: font.caption, fontWeight: 300, color: colors.textMuted }}>
                                        {getChannelDescription('stable')}
                                    </Typography>
                                </Stack>
                            </MenuItem>
                            <MenuItem value="dev">
                                <Stack>
                                    <Typography sx={{ fontSize: font.label, fontWeight: 400, color: colors.textWhite }}>Development</Typography>
                                    <Typography sx={{ fontSize: font.caption, fontWeight: 300, color: colors.textMuted }}>
                                        {getChannelDescription('dev')}
                                    </Typography>
                                </Stack>
                            </MenuItem>
                            <MenuItem value="local">
                                <Stack>
                                    <Typography sx={{ fontSize: font.label, fontWeight: 400, color: colors.textWhite }}>Local</Typography>
                                    <Typography sx={{ fontSize: font.caption, fontWeight: 300, color: colors.textMuted }}>
                                        {getChannelDescription('local')}
                                    </Typography>
                                </Stack>
                            </MenuItem>
                            <MenuItem value="custom">
                                <Stack>
                                    <Typography sx={{ fontSize: font.label, fontWeight: 400, color: colors.textWhite }}>Custom</Typography>
                                    <Typography sx={{ fontSize: font.caption, fontWeight: 300, color: colors.textMuted }}>
                                        {getChannelDescription('custom')}
                                    </Typography>
                                </Stack>
                            </MenuItem>
                        </Select>
                    </FormControl>

                    {config.channel === 'custom' && (
                        <TextField
                            fullWidth
                            label="Custom Update URL"
                            value={customUrl}
                            onChange={(e) => handleCustomUrlChange(e.target.value)}
                            placeholder="https://github.com/user/repo/archive/refs/heads/branch.zip"
                            disabled={loading}
                            helperText="Enter a valid zip file URL for template updates"
                        />
                    )}

                    <Typography sx={{ ...text.bodyMuted, mb: '20px' }}>
                        Current URL: {getUpdateUrl() || 'Default (no value)'}
                    </Typography>

                    <Box display="flex" justifyContent="flex-end">
                        {loading ? (
                            <Box display="flex" alignItems="center" gap={1}>
                                <CircularProgress size={24} />
                                <Typography sx={{ color: colors.textWhite }}>Saving and running self-check...</Typography>
                            </Box>
                        ) : (
                            <Button
                                variant="contained"
                                onClick={handleSaveChannel}
                                disabled={loading}
                                sx={button.primary}
                            >
                                Save Channel
                            </Button>
                        )}
                    </Box>
                </Stack>
            </CardContent>
        </Card>
    );
};
