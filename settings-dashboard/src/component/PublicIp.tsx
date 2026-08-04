import React, {useEffect, useState} from "react";
import {Alert, Card, CardContent, Box, Typography} from "@mui/material";
import {apiRequest} from "@/core/authApi";
import {card, colors, font, title} from '@/app/pages/softTheme';

/**
 * PublicIp — read-only display of the PCS public IP, fetched from
 * /api/admin/get-environment.
 */
export const PublicIp: React.FC = () => {
    const [publicIp, setPublicIp] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        (async () => {
            try {
                const response = await apiRequest<{
                    status: string;
                    data: { PUBLIC_IP: string };
                }>("/api/admin/get-environment", "GET");

                if (response.status === 'success') {
                    setPublicIp(response.data.PUBLIC_IP || '');
                } else {
                    setError('Failed to load configuration');
                }
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to load configuration');
            } finally {
                setLoading(false);
            }
        })();
    }, []);

    return (
        <Card sx={card.root}>
            <Box sx={card.header}>
                <Typography sx={title.small}>Public IP</Typography>
            </Box>
            <CardContent sx={card.content}>
                {loading && <Typography sx={{color: colors.textWhite}}>Loading…</Typography>}
                {error && <Alert severity="error">{error}</Alert>}
                {!loading && !error && (
                    <Typography sx={{
                        fontSize: font.label,
                        fontWeight: 700,
                        color: colors.textWhite,
                        fontFamily: 'monospace',
                        wordBreak: 'break-all',
                    }}>
                        {publicIp || '—'}
                    </Typography>
                )}
            </CardContent>
        </Card>
    );
};
