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

export type UpdateChannelType = 'stable' | 'dev' | 'local' | 'custom';

interface UpdateChannelConfig {
    channel: UpdateChannelType;
    customUrl?: string;
}

export const UpdateChannel: React.FC = () => {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [config, setConfig] = useState<UpdateChannelConfig>({
        channel: 'stable',
        customUrl: ''
    });
    const [customUrl, setCustomUrl] = useState('');
    const notify = useNotify();

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
            
            // Run self-check after updating the channel
            await apiRequest("/api/admin/self-check-run", "POST");
            notify('Self-check completed successfully');
            
        } catch (err: any) {
            setError(err.message || "Failed to save update channel");
        } finally {
            setLoading(false);
        }
    };

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

    useEffect(() => {
        loadCurrentConfig();
    }, []);

    return (
        <Card>
            <CardContent>
                <Stack spacing={3}>
                    <Typography variant="h5">Update Channel</Typography>
                    
                    {error && <Alert severity="error">{error}</Alert>}
                    
                    <FormControl fullWidth>
                        <InputLabel>Channel</InputLabel>
                        <Select
                            value={config.channel}
                            label="Channel"
                            onChange={(e) => handleChannelChange(e.target.value as UpdateChannelType)}
                            disabled={loading}
                        >
                            <MenuItem value="stable">
                                <Stack>
                                    <Typography>Stable</Typography>
                                    <Typography variant="body2" color="text.secondary">
                                        {getChannelDescription('stable')}
                                    </Typography>
                                </Stack>
                            </MenuItem>
                            <MenuItem value="dev">
                                <Stack>
                                    <Typography>Development</Typography>
                                    <Typography variant="body2" color="text.secondary">
                                        {getChannelDescription('dev')}
                                    </Typography>
                                </Stack>
                            </MenuItem>
                            <MenuItem value="local">
                                <Stack>
                                    <Typography>Local</Typography>
                                    <Typography variant="body2" color="text.secondary">
                                        {getChannelDescription('local')}
                                    </Typography>
                                </Stack>
                            </MenuItem>
                            <MenuItem value="custom">
                                <Stack>
                                    <Typography>Custom</Typography>
                                    <Typography variant="body2" color="text.secondary">
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

                    <Typography variant="body2" color="text.secondary">
                        Current URL: {getUpdateUrl() || 'Default (no value)'}
                    </Typography>

                    <Box display="flex" justifyContent="flex-end">
                        {loading ? (
                            <Box display="flex" alignItems="center" gap={1}>
                                <CircularProgress size={24} />
                                <Typography>Saving and running self-check...</Typography>
                            </Box>
                        ) : (
                            <Button
                                variant="contained"
                                color="primary"
                                onClick={handleSaveChannel}
                                disabled={loading}
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