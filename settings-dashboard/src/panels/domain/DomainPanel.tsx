import React, {useEffect, useState} from "react";
import {
    Alert,
    Box,
    Button,
    Card,
    CardContent,
    CircularProgress,
    FormControl,
    InputLabel,
    Link,
    MenuItem,
    Select,
    Stack,
    Typography,
} from "@mui/material";
import LinkIcon from "@mui/icons-material/Link";
import RefreshIcon from "@mui/icons-material/Refresh";
import {useNotify} from "react-admin";
import {apiRequest} from "@/core/authApi";
import {button, card, colors, font, radius, spacing, text, title} from '@/app/pages/softTheme';

interface DomainConfig {
    DOMAIN: string;
    PROVIDER_STR: string;
    PUBLIC_IP: string;
    DEFAULT_SERVICE_HOST: string;
    DEFAULT_SERVICE_PORT: string;
}

interface DockerContainer {
    name: string;
    image: string;
    ports: string[];
}

const selectSx = {
    color: colors.textWhite,
    '& .MuiOutlinedInput-notchedOutline': {borderColor: colors.textMuted},
    '&:hover .MuiOutlinedInput-notchedOutline': {borderColor: colors.textMuted},
    '&.Mui-focused .MuiOutlinedInput-notchedOutline': {borderColor: colors.textMuted},
    '& .MuiSvgIcon-root': {color: colors.textMuted},
};

const inputLabelSx = {
    fontSize: font.caption,
    fontWeight: 300,
    color: colors.textMuted,
    '&.Mui-focused': {color: colors.textMuted},
};

const ipToDash = (ip: string): string => ip.replace(/\./g, '-').replace(/:/g, '-');

const InfoRow: React.FC<{ label: string; value: React.ReactNode }> = ({label, value}) => (
    <Box sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        paddingY: '10px',
        borderBottom: `1px solid ${colors.borderMuted}`,
        '&:last-of-type': {borderBottom: 'none'},
    }}>
        <Typography sx={{
            fontSize: font.caption,
            fontWeight: 300,
            color: colors.textMuted,
            letterSpacing: '1px',
            textTransform: 'uppercase',
        }}>
            {label}
        </Typography>
        <Typography sx={{
            fontSize: font.label,
            fontWeight: 400,
            color: colors.textWhite,
            wordBreak: 'break-all',
        }}>
            {value || '—'}
        </Typography>
    </Box>
);

export const DomainPanel: React.FC = () => {
    const [config, setConfig] = useState<DomainConfig>({
        DOMAIN: '',
        PROVIDER_STR: '',
        PUBLIC_IP: '',
        DEFAULT_SERVICE_HOST: '',
        DEFAULT_SERVICE_PORT: '',
    });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [containers, setContainers] = useState<DockerContainer[]>([]);
    const [containersLoading, setContainersLoading] = useState(false);
    const [containersError, setContainersError] = useState<string | null>(null);
    const [selectedHost, setSelectedHost] = useState('');
    const [selectedPort, setSelectedPort] = useState('');
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    const notify = useNotify();

    const loadContainers = async () => {
        setContainersLoading(true);
        setContainersError(null);
        try {
            const res = await apiRequest<{ status: string; data: DockerContainer[] }>(
                "/api/admin/docker-ps",
                "GET",
            );
            setContainers(res.data || []);
        } catch (err) {
            setContainersError(err instanceof Error ? err.message : 'Failed to list containers');
        } finally {
            setContainersLoading(false);
        }
    };

    useEffect(() => {
        (async () => {
            try {
                setLoading(true);
                setError(null);
                const response = await apiRequest<{ status: string; data: DomainConfig }>(
                    "/api/admin/get-environment",
                    "GET",
                );
                if (response.status === 'success') {
                    setConfig(response.data);
                    setSelectedHost(response.data.DEFAULT_SERVICE_HOST || '');
                    setSelectedPort(response.data.DEFAULT_SERVICE_PORT || '');
                } else {
                    setError('Failed to load configuration');
                }
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to load configuration');
            } finally {
                setLoading(false);
            }
            loadContainers();
        })();
    }, []);

    const selectedContainer = containers.find(c => c.name === selectedHost);
    const portOptions = selectedContainer
        ? selectedContainer.ports
        : selectedPort
            ? [selectedPort]
            : [];

    const handleHostChange = (newHost: string) => {
        setSelectedHost(newHost);
        const c = containers.find(ct => ct.name === newHost);
        if (c && !c.ports.includes(selectedPort)) {
            setSelectedPort(c.ports[0] || '');
        }
    };

    const handleSave = async () => {
        setSaving(true);
        setSaveError(null);
        try {
            await apiRequest("/api/admin/default-app", "POST", {
                host: selectedHost,
                port: selectedPort,
            });
            await apiRequest("/api/admin/self-check-run", "POST");
            notify('Default app saved. Self-check started — watch the log on the Health page.');
            setConfig(prev => ({
                ...prev,
                DEFAULT_SERVICE_HOST: selectedHost,
                DEFAULT_SERVICE_PORT: selectedPort,
            }));
        } catch (err) {
            setSaveError(err instanceof Error ? err.message : 'Failed to save default app');
        } finally {
            setSaving(false);
        }
    };

    const isDirty =
        selectedHost !== (config.DEFAULT_SERVICE_HOST || '') ||
        selectedPort !== (config.DEFAULT_SERVICE_PORT || '');

    const sslipDomain = config.PUBLIC_IP ? `${ipToDash(config.PUBLIC_IP)}.sslip.io` : '';
    const sslipUrl = sslipDomain ? `https://${sslipDomain}/` : '';
    const pcsDomainUrl = config.DOMAIN ? `https://${config.DOMAIN}/` : '';
    const defaultApp = config.DEFAULT_SERVICE_HOST && config.DEFAULT_SERVICE_PORT
        ? `${config.DEFAULT_SERVICE_HOST}:${config.DEFAULT_SERVICE_PORT}`
        : '';

    return (
        <Box sx={{
            paddingTop: spacing.pageY,
            paddingBottom: spacing.pageY,
            paddingX: spacing.pageX,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
        }}>
            <Typography
                variant="h2"
                sx={{
                    textAlign: 'center',
                    fontSize: font.titleLarge,
                    fontWeight: 700,
                    color: colors.textWhite,
                    marginBottom: '30px',
                }}
            >
                Domain
            </Typography>

            <Box sx={{
                display: 'flex',
                flexDirection: 'column',
                gap: spacing.cardGap,
                maxWidth: '800px',
                width: '100%',
            }}>
                {/* Card 1 — PCS domain summary */}
                <Card sx={card.root}>
                    <Box sx={card.header}>
                        <Typography sx={title.small}>Your PCS Domain</Typography>
                    </Box>
                    <CardContent sx={card.content}>
                        {loading && (
                            <Typography sx={{color: colors.textWhite}}>Loading…</Typography>
                        )}
                        {error && <Alert severity="error">{error}</Alert>}
                        {!loading && !error && (
                            <>
                                <InfoRow
                                    label="PCS Domain"
                                    value={pcsDomainUrl ? (
                                        <Link href={pcsDomainUrl} target="_blank" rel="noopener noreferrer"
                                              sx={{color: colors.primary}}>
                                            {config.DOMAIN}
                                        </Link>
                                    ) : ''}
                                />
                                <InfoRow
                                    label="Default Application"
                                    value={defaultApp}
                                />
                                <InfoRow
                                    label="Provider"
                                    value={config.PROVIDER_STR}
                                />
                                <InfoRow
                                    label="sslip.io Domain"
                                    value={sslipUrl ? (
                                        <Link href={sslipUrl} target="_blank" rel="noopener noreferrer"
                                              sx={{color: colors.primary}}>
                                            {sslipDomain}
                                        </Link>
                                    ) : ''}
                                />
                                <InfoRow
                                    label="Public IP"
                                    value={config.PUBLIC_IP}
                                />

                                <Box sx={{marginTop: '25px', display: 'flex', justifyContent: 'center'}}>
                                    <Button
                                        variant="contained"
                                        href="https://nsl.sh"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        startIcon={<LinkIcon/>}
                                        sx={{
                                            ...button.primary,
                                            '&:hover': {
                                                ...button.primary['&:hover'],
                                                transform: 'translateY(-1px)',
                                            },
                                        }}
                                    >
                                        Visit nsl.sh
                                    </Button>
                                </Box>
                            </>
                        )}
                    </CardContent>
                </Card>

                {/* Card — Default app editor */}
                <Card sx={card.root}>
                    <Box sx={card.header}>
                        <Typography sx={title.small}>Default Application</Typography>
                    </Box>
                    <CardContent sx={card.content}>
                        <Typography sx={{...text.bodyMuted, mb: '20px'}}>
                            Choose which running container handles requests to your root domain
                            ({config.DOMAIN || 'your PCS domain'}). Saving applies the change and
                            triggers a self-check to reload the router.
                        </Typography>

                        {containersError && (
                            <Alert severity="error" sx={{mb: 2}}>{containersError}</Alert>
                        )}
                        {saveError && (
                            <Alert severity="error" sx={{mb: 2}}>{saveError}</Alert>
                        )}

                        <Stack direction={{xs: 'column', sm: 'row'}} spacing={2} alignItems="flex-start">
                            <FormControl sx={{flex: 2, minWidth: 200}}>
                                <InputLabel sx={inputLabelSx}>Container</InputLabel>
                                <Select
                                    value={selectedHost}
                                    label="Container"
                                    onChange={(e) => handleHostChange(e.target.value as string)}
                                    disabled={saving || containersLoading}
                                    sx={selectSx}
                                >
                                    {selectedHost && !containers.find(c => c.name === selectedHost) && (
                                        <MenuItem value={selectedHost}>
                                            <Stack>
                                                <Typography sx={{fontSize: font.label, color: colors.textWhite}}>
                                                    {selectedHost}
                                                </Typography>
                                                <Typography sx={{fontSize: font.caption, color: colors.textMuted}}>
                                                    not currently running
                                                </Typography>
                                            </Stack>
                                        </MenuItem>
                                    )}
                                    {containers.map(c => (
                                        <MenuItem key={c.name} value={c.name}>
                                            <Stack>
                                                <Typography sx={{fontSize: font.label, color: colors.textWhite}}>
                                                    {c.name}
                                                </Typography>
                                                <Typography sx={{fontSize: font.caption, color: colors.textMuted}}>
                                                    {c.image}
                                                </Typography>
                                            </Stack>
                                        </MenuItem>
                                    ))}
                                </Select>
                            </FormControl>

                            <FormControl sx={{flex: 1, minWidth: 120}}>
                                <InputLabel sx={inputLabelSx}>Port</InputLabel>
                                <Select
                                    value={selectedPort}
                                    label="Port"
                                    onChange={(e) => setSelectedPort(e.target.value as string)}
                                    disabled={saving || portOptions.length === 0}
                                    sx={selectSx}
                                >
                                    {portOptions.map(p => (
                                        <MenuItem key={p} value={p}>{p}</MenuItem>
                                    ))}
                                </Select>
                            </FormControl>

                            <Button
                                onClick={loadContainers}
                                disabled={containersLoading || saving}
                                title="Refresh container list"
                                sx={{
                                    color: colors.textMuted,
                                    minWidth: 0,
                                    height: 56,
                                }}
                            >
                                {containersLoading ? <CircularProgress size={20}/> : <RefreshIcon/>}
                            </Button>
                        </Stack>

                        <Box sx={{marginTop: '20px', display: 'flex', justifyContent: 'flex-end'}}>
                            <Button
                                variant="contained"
                                onClick={handleSave}
                                disabled={saving || !isDirty || !selectedHost || !selectedPort}
                                sx={button.primary}
                            >
                                {saving ? 'Saving…' : 'Save & apply'}
                            </Button>
                        </Box>
                    </CardContent>
                </Card>

                {/* Card 2 — Custom domain tutorial */}
                <Card sx={card.root}>
                    <Box sx={card.header}>
                        <Typography sx={title.small}>Use a Custom Domain</Typography>
                    </Box>
                    <CardContent sx={card.content}>
                        <Typography sx={{
                            fontSize: font.label,
                            fontWeight: 400,
                            color: colors.textWhite,
                            lineHeight: 1.6,
                            marginBottom: '15px',
                        }}>
                            You can point your own domain to this PCS. The recommended setup uses
                            Cloudflare for DNS and HTTPS, with a CNAME pointing to your sslip.io
                            address in proxy mode (orange cloud).
                        </Typography>

                        <Box sx={{
                            backgroundColor: colors.bgInput,
                            border: `1px solid ${colors.borderMuted}`,
                            borderRadius: radius.input,
                            padding: '16px 20px',
                            marginBottom: '20px',
                        }}>
                            <Typography sx={{
                                fontSize: font.caption,
                                fontWeight: 300,
                                color: colors.textMuted,
                                letterSpacing: '1px',
                                textTransform: 'uppercase',
                                marginBottom: '6px',
                            }}>
                                CNAME target
                            </Typography>
                            <Typography sx={{
                                fontSize: font.label,
                                fontWeight: 700,
                                color: colors.textWhite,
                                fontFamily: 'monospace',
                                wordBreak: 'break-all',
                            }}>
                                {sslipDomain || '—'}
                            </Typography>
                        </Box>

                        <Typography sx={{
                            fontSize: font.label,
                            fontWeight: 700,
                            color: colors.textWhite,
                            marginBottom: '10px',
                        }}>
                            Cloudflare setup (recommended)
                        </Typography>
                        <Box component="ol" sx={{
                            paddingLeft: '20px',
                            margin: 0,
                            color: colors.textWhite,
                            '& li': {
                                fontSize: font.label,
                                fontWeight: 400,
                                lineHeight: 1.6,
                                marginBottom: '8px',
                            },
                        }}>
                            <li>Add your domain to Cloudflare and update your registrar's nameservers.</li>
                            <li>
                                Create a <strong>CNAME</strong> record pointing your domain (or subdomain)
                                to <code style={{
                                fontFamily: 'monospace',
                                background: colors.bgInput,
                                padding: '2px 6px',
                                borderRadius: '4px',
                            }}>{sslipDomain || 'your-sslip-domain'}</code>.
                            </li>
                            <li>
                                Enable <strong>Proxy mode</strong> (orange cloud) so Cloudflare terminates HTTPS
                                and hides your origin IP.
                            </li>
                            <li>
                                Set the SSL/TLS encryption mode to <strong>Full</strong> or
                                <strong> Full (strict)</strong>.
                            </li>
                        </Box>

                        <Typography sx={{
                            fontSize: font.label,
                            fontWeight: 700,
                            color: colors.textWhite,
                            marginTop: '20px',
                            marginBottom: '10px',
                        }}>
                            Direct DNS (alternative)
                        </Typography>
                        <Typography sx={{
                            fontSize: font.label,
                            fontWeight: 400,
                            color: colors.textWhite,
                            lineHeight: 1.6,
                            marginBottom: '10px',
                        }}>
                            If you prefer not to use Cloudflare, point an <strong>A record</strong> at the
                            PCS public IP below. You will need to handle HTTPS certificates yourself.
                        </Typography>
                        <Box sx={{
                            backgroundColor: colors.bgInput,
                            border: `1px solid ${colors.borderMuted}`,
                            borderRadius: radius.input,
                            padding: '16px 20px',
                        }}>
                            <Typography sx={{
                                fontSize: font.caption,
                                fontWeight: 300,
                                color: colors.textMuted,
                                letterSpacing: '1px',
                                textTransform: 'uppercase',
                                marginBottom: '6px',
                            }}>
                                A record value
                            </Typography>
                            <Typography sx={{
                                fontSize: font.label,
                                fontWeight: 700,
                                color: colors.textWhite,
                                fontFamily: 'monospace',
                                wordBreak: 'break-all',
                            }}>
                                {config.PUBLIC_IP || '—'}
                            </Typography>
                        </Box>
                    </CardContent>
                </Card>
            </Box>
        </Box>
    );
};
