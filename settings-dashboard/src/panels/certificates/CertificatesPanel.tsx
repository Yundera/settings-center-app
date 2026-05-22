import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Alert,
    Box,
    Button,
    Card,
    CardContent,
    Chip,
    CircularProgress,
    Link,
    Stack,
    Typography,
} from '@mui/material';
import { Refresh as RefreshIcon } from '@mui/icons-material';
import { apiRequest } from '@/core/authApi';
import {
    card,
    chip as chipStyle,
    colors,
    font,
    spacing,
    text,
    title,
} from '@/app/pages/softTheme';
import {
    CertRow,
    CertSnapshot,
    CertStatus,
} from '@/backend/server/Certificates/CertificatesTypes';

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

const STATUS_META: Record<CertStatus, { label: string; color: string }> = {
    letsencrypt: { label: "Let's Encrypt", color: colors.statusSuccess },
    fallback:    { label: 'Internal CA',   color: colors.statusWarning },
    unreachable: { label: 'No response',   color: colors.statusErrorAlt },
};

function statusChipSx(c: string) {
    return {
        ...chipStyle.tag,
        color: `${c} !important`,
        border: `1px solid ${c} !important`,
        '& .MuiChip-label': { color: `${c} !important` },
    };
}

const outlineButton = {
    fontSize: font.detail,
    fontWeight: 700,
    padding: '6px 16px',
    borderRadius: '30px',
    textTransform: 'none' as const,
    color: colors.textWhite,
    borderColor: colors.textWhite,
    '&:hover': {
        borderColor: colors.textWhite,
        backgroundColor: 'rgba(255, 255, 255, 0.08)',
    },
    '&.Mui-disabled': {
        color: 'rgba(255, 255, 255, 0.4)',
        borderColor: 'rgba(255, 255, 255, 0.3)',
    },
};

const inlineCode = {
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
    padding: '1px 6px',
    borderRadius: '4px',
    fontFamily: 'monospace',
    fontSize: font.detail,
};

const logSx = {
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
    color: colors.textMuted,
    fontSize: font.caption,
    fontFamily: 'monospace',
    padding: '8px 12px',
    borderRadius: '4px',
    marginTop: '6px',
    marginBottom: 0,
    maxHeight: '160px',
    overflow: 'auto',
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-word' as const,
};

// Format a raw openssl notAfter date ("May 21 12:00:00 2026 GMT") to YYYY-MM-DD.
function formatExpiry(raw: string | null): string {
    if (!raw) return '—';
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return raw;
    return d.toISOString().slice(0, 10);
}

// Colour the expiry text: red if expired, orange if within two weeks.
function expiryColor(days: number | null): string {
    if (days === null) return colors.textMuted;
    if (days < 0) return colors.statusErrorAlt;
    if (days < 14) return colors.statusWarning;
    return colors.textMuted;
}

function expiryText(row: CertRow): string {
    if (row.status === 'unreachable') return 'TLS handshake on :443 returned no certificate';
    const date = formatExpiry(row.notAfter);
    if (row.expiresInDays === null) return `expires ${date}`;
    if (row.expiresInDays < 0) return `expired ${date} (${-row.expiresInDays}d ago)`;
    return `expires ${date} (in ${row.expiresInDays}d)`;
}

// --------------------------------------------------------------------------
// Per-domain row
// --------------------------------------------------------------------------

const CertRowView: React.FC<{ row: CertRow }> = ({ row }) => {
    const meta = STATUS_META[row.status];
    const [showDetail, setShowDetail] = useState(false);
    return (
        <Box sx={{
            border: `1px solid ${colors.borderMuted}`,
            borderRadius: '8px',
            padding: '12px 16px',
        }}>
            <Stack direction="row" alignItems="center" spacing={2} sx={{ flexWrap: 'wrap', gap: 1 }}>
                <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                    <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 0.5, flexWrap: 'wrap', gap: 1 }}>
                        <Link
                            href={`https://${row.domain}/`}
                            target="_blank"
                            rel="noopener noreferrer"
                            sx={{ ...text.label, fontFamily: 'monospace', color: colors.primary }}
                        >
                            {row.domain}
                        </Link>
                        <Chip
                            label={meta.label}
                            size="small"
                            variant="outlined"
                            sx={statusChipSx(meta.color)}
                        />
                    </Stack>
                    <Typography sx={text.detail}>
                        served by {row.sources.length ? row.sources.join(', ') : '—'}
                        {' · '}
                        <Box component="span" sx={{ color: expiryColor(row.expiresInDays) }}>
                            {expiryText(row)}
                        </Box>
                    </Typography>
                    {row.issuer && (
                        <Typography sx={{ ...text.detail, fontSize: font.caption }}>
                            issuer: {row.issuer}
                        </Typography>
                    )}
                    {row.reason && (
                        <Typography sx={{ ...text.detail, color: meta.color, mt: 0.5 }}>
                            Reason: {row.reason}
                        </Typography>
                    )}
                    {row.reasonDetail && (
                        <Box>
                            <Link
                                component="button"
                                type="button"
                                onClick={() => setShowDetail(s => !s)}
                                sx={{
                                    ...text.detail,
                                    fontSize: font.caption,
                                    color: colors.textMuted,
                                    textAlign: 'left',
                                }}
                            >
                                {showDetail ? 'Hide Caddy log line' : 'Show Caddy log line'}
                            </Link>
                            {showDetail && (
                                <Box component="pre" sx={logSx}>{row.reasonDetail}</Box>
                            )}
                        </Box>
                    )}
                </Box>
            </Stack>
        </Box>
    );
};

// --------------------------------------------------------------------------
// Main panel
// --------------------------------------------------------------------------

export const CertificatesPanel: React.FC = () => {
    const [data, setData] = useState<CertSnapshot | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const refresh = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const r = await apiRequest<CertSnapshot>('/api/admin/certificates', 'GET');
            setData(r);
        } catch (err: any) {
            setError(err?.message || 'Failed to check certificates');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { refresh(); }, [refresh]);

    const summary = useMemo(() => {
        const certs = data?.certs ?? [];
        return {
            total: certs.length,
            letsencrypt: certs.filter(c => c.status === 'letsencrypt').length,
            fallback: certs.filter(c => c.status === 'fallback').length,
            unreachable: certs.filter(c => c.status === 'unreachable').length,
        };
    }, [data]);

    return (
        <Box sx={{
            paddingTop: spacing.pageY,
            paddingBottom: spacing.pageY,
            paddingX: spacing.pageX,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
        }}>
            <Typography sx={{ ...title.large, textAlign: 'center', marginBottom: '15px' }}>
                Certificates
            </Typography>
            <Typography sx={{
                ...text.detail,
                textAlign: 'center',
                maxWidth: '800px',
                marginBottom: '30px',
            }}>
                Every <Box component="code" sx={inlineCode}>.sslip.io</Box> domain this PCS
                serves, with the certificate Caddy currently presents on it. A local TLS
                handshake on port 443 reveals whether the live certificate was issued by
                Let&apos;s Encrypt or by Yundera&apos;s internal fallback CA.
            </Typography>

            {error && (
                <Alert severity="error" sx={{ mb: 2, maxWidth: '900px', width: '100%' }}>
                    {error}
                </Alert>
            )}

            <Box sx={{
                display: 'flex',
                flexDirection: 'column',
                gap: spacing.cardGap,
                maxWidth: '900px',
                width: '100%',
            }}>
                {/* Summary */}
                <Card sx={card.root}>
                    <Box sx={card.header}>
                        <Stack direction="row" alignItems="center" justifyContent="space-between">
                            <Typography sx={title.small}>Summary</Typography>
                            <Button
                                onClick={refresh}
                                startIcon={loading ? <CircularProgress size={14} /> : <RefreshIcon />}
                                disabled={loading}
                                sx={outlineButton}
                            >
                                Refresh
                            </Button>
                        </Stack>
                    </Box>
                    <CardContent sx={card.content}>
                        <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
                            <Chip
                                label={`${summary.total} domains`}
                                sx={statusChipSx(colors.textWhite)}
                                variant="outlined"
                            />
                            <Chip
                                label={`${summary.letsencrypt} Let's Encrypt`}
                                sx={statusChipSx(colors.statusSuccess)}
                                variant="outlined"
                            />
                            <Chip
                                label={`${summary.fallback} internal CA`}
                                sx={statusChipSx(summary.fallback ? colors.statusWarning : colors.textSubtle)}
                                variant="outlined"
                            />
                            <Chip
                                label={`${summary.unreachable} no response`}
                                sx={statusChipSx(summary.unreachable ? colors.statusErrorAlt : colors.textSubtle)}
                                variant="outlined"
                            />
                        </Stack>
                        {data && (
                            <Typography sx={{ ...text.detail, fontSize: font.caption, mt: 2 }}>
                                Snapshot taken {new Date(data.snapshotAt).toLocaleString()}
                            </Typography>
                        )}
                    </CardContent>
                </Card>

                {/* Domains */}
                <Card sx={card.root}>
                    <Box sx={card.header}>
                        <Typography sx={title.small}>sslip.io Domains</Typography>
                    </Box>
                    <CardContent sx={card.content}>
                        {loading && !data && (
                            <Typography sx={text.bodyMuted}>Checking certificates…</Typography>
                        )}
                        {!loading && data && data.certs.length === 0 && (
                            <Typography sx={text.bodyMuted}>
                                No <Box component="code" sx={inlineCode}>.sslip.io</Box> domains
                                found on any running container.
                            </Typography>
                        )}
                        {data && data.certs.length > 0 && (
                            <Stack spacing={1.5}>
                                {data.certs.map(row => (
                                    <CertRowView key={row.domain} row={row} />
                                ))}
                            </Stack>
                        )}
                    </CardContent>
                </Card>

                {/* Note */}
                <Alert severity="info" sx={{ width: '100%' }}>
                    Only <Box component="code" sx={inlineCode}>.sslip.io</Box> domains use
                    Let&apos;s Encrypt. Gateway routes (your PCS domain) and
                    {' '}<Box component="code" sx={inlineCode}>.nip.io</Box> routes
                    intentionally use Yundera&apos;s internal CA, so they are not listed
                    here. An <strong>Internal CA</strong> or <strong>No response</strong>
                    {' '}result on a sslip.io domain means Caddy could not obtain a
                    Let&apos;s Encrypt certificate and fell back to a self-signed one — the
                    <strong> Reason</strong> on each such domain is read from the Caddy
                    container&apos;s recent logs.
                </Alert>
            </Box>
        </Box>
    );
};
