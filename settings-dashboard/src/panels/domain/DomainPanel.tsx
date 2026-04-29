import React, {useEffect, useState} from "react";
import {
    Alert,
    Box,
    Button,
    Card,
    CardContent,
    Link,
    Typography,
} from "@mui/material";
import LinkIcon from "@mui/icons-material/Link";
import {apiRequest} from "@/core/authApi";
import {button, card, colors, font, radius, spacing, title} from '@/app/pages/softTheme';

interface DomainConfig {
    DOMAIN: string;
    PROVIDER_STR: string;
    PUBLIC_IP: string;
    DEFAULT_SERVICE_HOST: string;
    DEFAULT_SERVICE_PORT: string;
}

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

    const sslipDomain = config.PUBLIC_IP ? `${ipToDash(config.PUBLIC_IP)}.sslip.io` : '';
    const sslipUrl = sslipDomain ? `https://${sslipDomain}/` : '';
    const pcsDomainUrl = config.DOMAIN ? `https://${config.DOMAIN}/` : '';
    const defaultApp = config.DEFAULT_SERVICE_HOST && config.DEFAULT_SERVICE_PORT
        ? `${config.DEFAULT_SERVICE_HOST}:${config.DEFAULT_SERVICE_PORT}`
        : '';

    return (
        <Box sx={{
            backgroundColor: colors.bgPage,
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
