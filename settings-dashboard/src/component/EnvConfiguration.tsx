import React, { useState, useEffect } from "react";
import {
    Card,
    CardContent,
    TextField,
    IconButton,
    InputAdornment,
    Box,
    Typography,
    Alert,
} from "@mui/material";
import {
    Visibility,
    VisibilityOff,
    Domain,
    Person,
    Settings,
    VpnKey,
    PublicSharp,
    AccountCircle,
} from "@mui/icons-material";
import {apiRequest} from "@/core/authApi";
import { colors, font, radius, card, title } from '@/app/pages/softTheme';

// Environment config values returned from the backend API
interface ConfigValues {
    DOMAIN: string;
    PROVIDER_STR: string;
    UID: string;
    DEFAULT_PWD: string;
    PUBLIC_IP: string;
    DEFAULT_USER: string;
}

/**
 * EnvConfiguration — Read-only display of server environment variables.
 * Fetches config from /api/admin/get-environment and renders each field
 * with an icon. The password field supports visibility toggle.
 */
export const EnvConfiguration: React.FC = () => {
    // ===== Backend logic — do not modify =====
    const [showPassword, setShowPassword] = useState(false);
    const [config, setConfig] = useState<ConfigValues>({
        DOMAIN: '',
        PROVIDER_STR: '',
        UID: '',
        DEFAULT_PWD: '',
        PUBLIC_IP: '',
        DEFAULT_USER: '',
    });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Fetch environment configuration on mount
    useEffect(() => {
        const fetchConfig = async () => {
            try {
                setLoading(true);
                setError(null);

                const response = await apiRequest<{
                    status: string;
                    data: ConfigValues;
                }>("/api/admin/get-environment", "GET");

                if (response.status === 'success') {
                    setConfig(response.data);
                } else {
                    setError('Failed to load configuration');
                }
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to load configuration');
            } finally {
                setLoading(false);
            }
        };

        fetchConfig();
    }, []);

    const handleTogglePasswordVisibility = () => {
        setShowPassword((prev) => !prev);
    };

    // Field definitions — each entry maps a config key to its display label and icon
    const configFields = [
        {
            key: "DEFAULT_PWD",
            label: "Password",
            value: config.DEFAULT_PWD,
            icon: <VpnKey sx={{ color: colors.textMuted }} />,
            type: "password",
        },
        {
            key: "DOMAIN",
            label: "Domain",
            value: config.DOMAIN,
            icon: <Domain sx={{ color: colors.textMuted }} />,
            type: "text",
        },
        {
            key: "PROVIDER_STR",
            label: "Provider",
            value: config.PROVIDER_STR,
            icon: <Settings sx={{ color: colors.textMuted }} />,
            type: "text",
        },
        {
            key: "UID",
            label: "User ID",
            value: config.UID,
            icon: <Person sx={{ color: colors.textMuted }} />,
            type: "text",
        },
        {
            key: "DEFAULT_USER",
            label: "Default User",
            value: config.DEFAULT_USER,
            icon: <AccountCircle sx={{ color: colors.textMuted }} />,
            type: "text",
        },
        {
            key: "PUBLIC_IP",
            label: "Public IP",
            value: config.PUBLIC_IP,
            icon: <PublicSharp sx={{ color: colors.textMuted }} />,
            type: "text",
        },
    ];
    // ===== End of backend logic =====

    if (loading) {
        return (
            <Card>
                <CardContent sx={{ textAlign: 'center', py: 4 }}>
                    <Typography sx={{ color: colors.textWhite }}>Loading configuration...</Typography>
                </CardContent>
            </Card>
        );
    }

    if (error) {
        return (
            <Card>
                <CardContent>
                    <Alert severity="error">{error}</Alert>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card sx={card.root}>
            {/* Card header — blue banner with title */}
            <Box sx={card.header}>
                <Typography sx={title.small}>
                    System Configuration
                </Typography>
            </Box>

            <CardContent sx={card.content}>
                {/* Read-only text fields for each environment config value */}
                <Box sx={{
                    display: "flex",
                    flexDirection: "column",
                    gap: '20px',
                }}>
                    {configFields.map((field) => (
                        <TextField
                            key={field.key}
                            fullWidth
                            label={field.label}
                            value={field.value || ''}
                            type={field.type === "password" && !showPassword ? "password" : "text"}
                            variant="outlined"
                            InputProps={{
                                readOnly: true,
                                startAdornment: (
                                    <InputAdornment position="start">
                                        {field.icon}
                                    </InputAdornment>
                                ),
                                endAdornment: field.type === "password" && (
                                    <InputAdornment position="end">
                                        <IconButton
                                            aria-label="toggle password visibility"
                                            onClick={handleTogglePasswordVisibility}
                                            edge="end"
                                            size="small"
                                            sx={{ color: colors.textMuted }}
                                        >
                                            {showPassword ? <VisibilityOff /> : <Visibility />}
                                        </IconButton>
                                    </InputAdornment>
                                ),
                            }}
                            InputLabelProps={{
                                sx: {
                                    color: colors.textMuted,
                                    fontSize: font.caption,
                                    fontWeight: 300,
                                    '&.Mui-focused': {
                                        color: colors.primary,
                                    },
                                }
                            }}
                            sx={{
                                '& .MuiOutlinedInput-root': {
                                    backgroundColor: colors.bgInput,
                                    borderRadius: radius.input,
                                    minHeight: '50px',
                                    color: colors.textWhite,
                                    '& fieldset': {
                                        borderColor: colors.borderMuted,
                                    },
                                    '&:hover fieldset': {
                                        borderColor: colors.primary,
                                    },
                                    '&.Mui-focused fieldset': {
                                        borderColor: colors.primary,
                                        boxShadow: '0 0 0 3px rgba(39, 170, 225, 0.1)',
                                    },
                                },
                                '& .MuiInputBase-input': {
                                    color: colors.textWhite,
                                },
                            }}
                        />
                    ))}
                </Box>

                {/* Info box — read-only notice */}
                <Box sx={{
                    mt: '20px',
                    p: '16px 20px',
                    backgroundColor: colors.textMuted,
                    borderRadius: radius.input,
                    boxShadow: '3px 3px 8px 1px rgba(20, 61, 102, 0.44)',
                }}>
                    <Typography
                        variant="body2"
                        sx={{
                            fontSize: font.label,
                            fontWeight: 300,
                            color: colors.textDark,
                        }}
                    >
                        Configuration values are read-only. The password field can be toggled for visibility.
                    </Typography>
                </Box>
            </CardContent>
        </Card>
    );
};
