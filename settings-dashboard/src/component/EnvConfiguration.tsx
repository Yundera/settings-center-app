import React, { useState, useEffect } from "react";
import {
    Card,
    CardContent,
    CardHeader,
    TextField,
    IconButton,
    InputAdornment,
    Box,
    Typography,
    Divider,
    CircularProgress,
    Alert,
} from "@mui/material";
import axios from "axios";
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

interface ConfigValues {
    DOMAIN: string;
    PROVIDER_STR: string;
    UID: string;
    DEFAULT_PWD: string;
    PUBLIC_IP: string;
    DEFAULT_USER: string;
}

export const EnvConfiguration: React.FC = () => {
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

    const configFields = [
        {
            key: "DEFAULT_PWD",
            label: "Default Password",
            value: config.DEFAULT_PWD,
            icon: <VpnKey />,
            type: "password",
        },
        {
            key: "DOMAIN",
            label: "Domain",
            value: config.DOMAIN,
            icon: <Domain />,
            type: "text",
        },
        {
            key: "PROVIDER_STR",
            label: "Provider",
            value: config.PROVIDER_STR,
            icon: <Settings />,
            type: "text",
        },
        {
            key: "UID",
            label: "User ID",
            value: config.UID,
            icon: <Person />,
            type: "text",
        },
        {
            key: "DEFAULT_USER",
            label: "Default User",
            value: config.DEFAULT_USER,
            icon: <AccountCircle />,
            type: "text",
        },
        {
            key: "PUBLIC_IP",
            label: "Public IP",
            value: config.PUBLIC_IP,
            icon: <PublicSharp />,
            type: "text",
        },
    ];

    return (
        <Card
            sx={{
                maxWidth: 600,
                margin: "auto",
                mt: 4,
                boxShadow: 3,
                borderRadius: 2,
            }}
        >
            <CardHeader
                title={
                    <Typography variant="h5" component="h2" sx={{ fontWeight: 600 }}>
                        System Configuration
                    </Typography>
                }
                sx={{
                    backgroundColor: (theme) => theme.palette.primary.main,
                    color: (theme) => theme.palette.primary.contrastText,
                }}
            />
            <CardContent sx={{ p: 3 }}>
                <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}>
                    {configFields.map((field, index) => (
                        <Box key={field.key}>
                            <TextField
                                fullWidth
                                label={field.label}
                                value={field.value}
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
                                            >
                                                {showPassword ? <VisibilityOff /> : <Visibility />}
                                            </IconButton>
                                        </InputAdornment>
                                    ),
                                }}
                                sx={{
                                    "& .MuiOutlinedInput-root": {
                                        backgroundColor: (theme) => theme.palette.grey[50],
                                        "& fieldset": {
                                            borderColor: (theme) => theme.palette.grey[300],
                                        },
                                        "&:hover fieldset": {
                                            borderColor: (theme) => theme.palette.grey[400],
                                        },
                                    },
                                }}
                            />
                            {index < configFields.length - 1 && (
                                <Divider sx={{ mt: 1, opacity: 0.3 }} />
                            )}
                        </Box>
                    ))}
                </Box>

                <Box sx={{ mt: 3, p: 2, backgroundColor: (theme) => theme.palette.info.light, borderRadius: 1 }}>
                    <Typography variant="body2" color="text.secondary" sx={{ fontStyle: "italic" }}>
                        💡 Configuration values are read-only. The password field can be toggled for visibility.
                    </Typography>
                </Box>
            </CardContent>
        </Card>
    );
};