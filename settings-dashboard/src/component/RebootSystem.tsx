import React, {useState} from 'react';
import {
    Button,
    Card,
    CardContent,
    Box,
    Typography,
    Stack,
} from "@mui/material";
import {RestartAlt} from "@mui/icons-material";
import {apiRequest} from "@/core/authApi";
import {useNotify} from "react-admin";
import {card, title, button, text} from '@/app/pages/softTheme';

/**
 * RebootSystem — triggers a host reboot via SSH. The host comes back on its
 * own; the dashboard becomes unreachable for ~1–2 minutes during the reboot.
 */
export const RebootSystem: React.FC = () => {
    const [rebooting, setRebooting] = useState(false);
    const notify = useNotify();

    const handleReboot = async () => {
        if (!window.confirm('Reboot the host now? The PCS will be unreachable for 1–2 minutes.')) {
            return;
        }
        setRebooting(true);
        try {
            await apiRequest("/api/admin/reboot", "POST");
            notify('Reboot initiated. The PCS will be unreachable shortly.');
        } catch (err: any) {
            notify(err.message || 'Failed to reboot host', {type: 'error'});
            setRebooting(false);
        }
    };

    return (
        <Card sx={card.root}>
            <Box sx={card.header}>
                <Typography sx={title.small}>Power</Typography>
            </Box>
            <CardContent sx={card.content}>
                <Stack spacing={2}>
                    <Typography variant="body2" sx={text.detail}>
                        Reboots the host system via SSH. Use this if the PCS becomes
                        unresponsive or after a configuration change that requires a restart.
                    </Typography>
                    <Box>
                        <Button
                            variant="contained"
                            color="error"
                            startIcon={<RestartAlt/>}
                            onClick={handleReboot}
                            disabled={rebooting}
                            sx={button.primary}
                        >
                            {rebooting ? 'Rebooting…' : 'Reboot host'}
                        </Button>
                    </Box>
                </Stack>
            </CardContent>
        </Card>
    );
};
