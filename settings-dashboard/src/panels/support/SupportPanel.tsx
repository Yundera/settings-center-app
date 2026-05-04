import React, { useCallback, useEffect, useState } from "react";
import {
    Alert,
    Box,
    Button,
    Checkbox,
    Chip,
    CircularProgress,
    Divider,
    FormControlLabel,
    Stack,
    Switch,
    TextField,
    Typography,
} from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import SendIcon from "@mui/icons-material/Send";
import { apiRequest } from "@/core/authApi";
import { colors, font } from "@/app/pages/softTheme";

interface SupportAccessStatus {
    enabled: boolean;
    username: string;
    fingerprint: string;
    comment: string;
}

interface SendReportResponse {
    sent: boolean;
    to: string;
    grantedAccess: boolean;
    fingerprint: string | null;
}

const SectionHeading: React.FC<{ children: React.ReactNode; right?: React.ReactNode }> = ({ children, right }) => (
    <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
        <Typography sx={{ fontSize: font.title, fontWeight: 700, color: colors.textWhite }}>
            {children}
        </Typography>
        {right}
    </Stack>
);

export const SupportPanel: React.FC = () => {
    const [status, setStatus] = useState<SupportAccessStatus | null>(null);
    const [statusLoading, setStatusLoading] = useState<boolean>(true);
    const [statusError, setStatusError] = useState<string | null>(null);
    const [toggling, setToggling] = useState<boolean>(false);

    const [subject, setSubject] = useState<string>("");
    const [message, setMessage] = useState<string>("");
    const [includeLog, setIncludeLog] = useState<boolean>(true);
    const [grantAccess, setGrantAccess] = useState<boolean>(false);
    const [sending, setSending] = useState<boolean>(false);
    const [sendResult, setSendResult] = useState<{ ok: boolean; text: string } | null>(null);

    const fetchStatus = useCallback(async () => {
        setStatusLoading(true);
        try {
            const res = await apiRequest<SupportAccessStatus>("/api/admin/support-access", "GET");
            setStatus(res);
            setStatusError(null);
        } catch (err: any) {
            setStatusError(err?.message || "Failed to load support access status");
        } finally {
            setStatusLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchStatus();
    }, [fetchStatus]);

    const handleToggle = async (next: boolean) => {
        setToggling(true);
        try {
            await apiRequest("/api/admin/support-access", "POST", { enable: next });
            await fetchStatus();
        } catch (err: any) {
            setStatusError(err?.message || "Failed to update support access");
        } finally {
            setToggling(false);
        }
    };

    const handleSend = async () => {
        setSending(true);
        setSendResult(null);
        try {
            const res = await apiRequest<SendReportResponse>(
                "/api/admin/support-send-report",
                "POST",
                { subject, message, includeLog, grantAccess },
            );
            setSendResult({
                ok: true,
                text: `Sent to ${res.to}.${res.grantedAccess ? ' Support access enabled.' : ''}`,
            });
            setSubject("");
            setMessage("");
            if (grantAccess) await fetchStatus();
        } catch (err: any) {
            setSendResult({ ok: false, text: err?.message || "Failed to send report" });
        } finally {
            setSending(false);
        }
    };

    return (
        <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 960 }}>
            <Typography
                variant="h2"
                sx={{
                    fontSize: font.titleLarge,
                    fontWeight: 700,
                    color: colors.textWhite,
                    mb: 3,
                }}
            >
                Support
            </Typography>

            {/* Section: support access toggle */}
            <SectionHeading
                right={
                    <Button
                        onClick={fetchStatus}
                        disabled={statusLoading}
                        size="small"
                        startIcon={statusLoading ? <CircularProgress size={14} /> : <RefreshIcon />}
                        sx={{ color: colors.textMuted, '&:hover': { color: colors.textWhite } }}
                    >
                        Refresh
                    </Button>
                }
            >
                Yundera support SSH access
            </SectionHeading>

            {statusError && <Alert severity="error" sx={{ mb: 2 }}>{statusError}</Alert>}

            <Typography sx={{ color: colors.textMuted, fontSize: font.detail, mb: 2 }}>
                When enabled, Yundera support staff can SSH into <code>{status?.username || 'admin'}</code> on
                this PCS using the orchestrator's support key. You can revoke access at any time.
            </Typography>

            <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 1.5 }}>
                <FormControlLabel
                    sx={{ m: 0 }}
                    control={
                        <Switch
                            checked={!!status?.enabled}
                            onChange={(_, v) => handleToggle(v)}
                            disabled={statusLoading || toggling || !status}
                        />
                    }
                    label={
                        <Typography sx={{ color: colors.textWhite, fontSize: font.label }}>
                            {status?.enabled ? "Enabled" : "Disabled"}
                        </Typography>
                    }
                />
                {toggling && <CircularProgress size={16} />}
                {status && (
                    <Chip
                        label={status.enabled ? "Access granted" : "No access"}
                        color={status.enabled ? "success" : "default"}
                        size="small"
                    />
                )}
            </Stack>

            {status?.fingerprint && (
                <Typography sx={{
                    color: colors.textMuted,
                    fontSize: font.caption,
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                    wordBreak: 'break-all',
                }}>
                    {status.fingerprint} <span style={{ opacity: 0.7 }}>({status.comment})</span>
                </Typography>
            )}

            <Divider sx={{ my: 4, borderColor: colors.borderMuted }} />

            {/* Section: contact form */}
            <SectionHeading>Contact support</SectionHeading>

            <Typography sx={{ color: colors.textMuted, fontSize: font.detail, mb: 2 }}>
                Send a message to the Yundera support team. Optionally attach the last
                5000 lines of <code>yundera.log</code> and grant SSH access for the duration
                of the investigation.
            </Typography>

            {sendResult && (
                <Alert severity={sendResult.ok ? "success" : "error"} sx={{ mb: 2 }}>
                    {sendResult.text}
                </Alert>
            )}

            <Stack spacing={2}>
                <TextField
                    label="Subject"
                    fullWidth
                    value={subject}
                    onChange={e => setSubject(e.target.value)}
                    disabled={sending}
                    inputProps={{ maxLength: 200 }}
                />
                <TextField
                    label="Describe the issue"
                    fullWidth
                    multiline
                    minRows={6}
                    value={message}
                    onChange={e => setMessage(e.target.value)}
                    disabled={sending}
                    inputProps={{ maxLength: 10000 }}
                    helperText={`${message.length}/10000`}
                />

                <Stack>
                    <FormControlLabel
                        control={
                            <Checkbox
                                checked={includeLog}
                                onChange={(_, v) => setIncludeLog(v)}
                                disabled={sending}
                            />
                        }
                        label={
                            <Typography sx={{ color: colors.textWhite, fontSize: font.detail }}>
                                Attach yundera.log (last 5000 lines, gzipped)
                            </Typography>
                        }
                    />
                    <FormControlLabel
                        control={
                            <Checkbox
                                checked={grantAccess}
                                onChange={(_, v) => setGrantAccess(v)}
                                disabled={sending}
                            />
                        }
                        label={
                            <Typography sx={{ color: colors.textWhite, fontSize: font.detail }}>
                                {status?.enabled
                                    ? "Support access is already enabled"
                                    : "Grant Yundera support SSH access (you can revoke any time)"}
                            </Typography>
                        }
                    />
                </Stack>

                <Box>
                    <Button
                        onClick={handleSend}
                        disabled={sending || !subject.trim() || !message.trim()}
                        variant="contained"
                        startIcon={sending ? <CircularProgress size={14} /> : <SendIcon />}
                    >
                        Send to support
                    </Button>
                </Box>
            </Stack>
        </Box>
    );
};
