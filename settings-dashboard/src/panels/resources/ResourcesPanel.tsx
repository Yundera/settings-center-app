import React, { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import { colors, font, spacing } from "@/app/pages/softTheme";
import { apiRequest } from "@/core/authApi";

const REFRESH_MS = 5000;
const MAX_HISTORY = 60; // 5 minutes at 5s polling

// ============================================================
// Types — mirror src/backend/server/Metrics/Metrics.ts
// ============================================================

interface Sample {
    uptime: number;
    sampledAt: number;
    load1: number; load5: number; load15: number;
    nproc: number;
    mem: {
        totalBytes: number; freeBytes: number; availableBytes: number;
        buffersBytes: number; cachedBytes: number;
        swapTotalBytes: number; swapFreeBytes: number;
    };
    disks: { device: string; readsCompleted: number; sectorsRead: number;
             writesCompleted: number; sectorsWritten: number }[];
    nets: { iface: string; rxBytes: number; txBytes: number }[];
    filesystems: { source: string; target: string; sizeBytes: number;
                   usedBytes: number; availBytes: number }[];
    topProcesses: { pid: number; user: string; cpuPct: number;
                    memPct: number; comm: string }[];
}

interface MetricsSnapshot {
    sample: Sample | null;
    rates: {
        cpuBusyFrac: number | null;
        diskReadBps: Record<string, number>;
        diskWriteBps: Record<string, number>;
        netRxBps: Record<string, number>;
        netTxBps: Record<string, number>;
    };
    lastRefreshedAt: string | null;
    lastError: string | null;
}

// Mirror the response shapes of /api/admin/resources/{network,disk}-test.
interface NetworkTestResult {
    downloadBps: number; uploadBps: number;
    downloadSeconds: number; uploadSeconds: number;
    sizeBytes: number; target: string; ranAt: string;
}
interface DiskTestResult {
    writeBps: number; readBps: number;
    writeSeconds: number; readSeconds: number;
    sizeBytes: number; target: string; ranAt: string;
}

// ============================================================
// Format helpers
// ============================================================

function formatBytes(n: number | null | undefined): string {
    if (n == null || !Number.isFinite(n)) return "—";
    if (n < 1024) return `${n.toFixed(0)} B`;
    const units = ["KB", "MB", "GB", "TB", "PB"];
    let v = n / 1024;
    let i = 0;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return `${v < 10 ? v.toFixed(2) : v < 100 ? v.toFixed(1) : v.toFixed(0)} ${units[i]}`;
}

function formatRate(bps: number | null | undefined): string {
    if (bps == null || !Number.isFinite(bps)) return "—";
    return `${formatBytes(bps)}/s`;
}

// Network speeds are conventionally reported in Mbps (megabits), not MB/s.
// 1 Mbps = 1,000,000 bits/s = 125,000 bytes/s.
function formatMbps(bps: number | null | undefined): string {
    if (bps == null || !Number.isFinite(bps)) return "—";
    const mbps = (bps * 8) / 1_000_000;
    return `${mbps < 10 ? mbps.toFixed(2) : mbps < 100 ? mbps.toFixed(1) : mbps.toFixed(0)} Mbps`;
}

function formatSeconds(s: number): string {
    return s < 1 ? `${(s * 1000).toFixed(0)} ms` : `${s.toFixed(2)} s`;
}

function formatRelativeTime(iso: string): string {
    const ms = Date.now() - new Date(iso).getTime();
    if (ms < 60_000) return "just now";
    const min = Math.floor(ms / 60_000);
    if (min < 60) return `${min} min ago`;
    const h = Math.floor(min / 60);
    return `${h}h ago`;
}

function formatPercent(frac: number | null | undefined): string {
    if (frac == null || !Number.isFinite(frac)) return "—";
    return `${(frac * 100).toFixed(1)}%`;
}

function formatUptime(seconds: number): string {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
}

// Hide Docker-created bridges, veth pairs, and loopback — they clutter the UI
// without telling the operator anything actionable. Matches `docker0`, `br-<hash>`,
// `veth<hash>`, and `lo`.
function isVirtualInterface(iface: string): boolean {
    return iface === "lo"
        || iface === "docker0"
        || iface.startsWith("br-")
        || iface.startsWith("veth");
}

// A device is a partition if another device in the same list is its parent
// (e.g. `sda1` -> `sda`, `nvme0n1p1` -> `nvme0n1`, `mmcblk0p1` -> `mmcblk0`).
function isPartition(device: string, allDevices: string[]): boolean {
    const stripDigits = device.replace(/\d+$/, "");
    if (stripDigits !== device && allDevices.includes(stripDigits)) return true;
    const stripPDigits = device.replace(/p\d+$/, "");
    if (stripPDigits !== device && allDevices.includes(stripPDigits)) return true;
    return false;
}

// ============================================================
// Main panel
// ============================================================

export const ResourcesPanel = () => {
    const [tab, setTab] = useState<"network" | "disk" | "cpu">("cpu");
    const [history, setHistory] = useState<MetricsSnapshot[]>([]);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        async function poll() {
            try {
                const json = await apiRequest<MetricsSnapshot>("/api/admin/metrics", "GET");
                if (cancelled) return;
                setError(null);
                // Only append when the backend has a sample. Skip lookups that
                // returned the initial all-null state (e.g. during refresh hiccup).
                if (!json.sample) return;
                setHistory(h => {
                    const last = h[h.length - 1];
                    if (last?.lastRefreshedAt === json.lastRefreshedAt) return h; // dedupe
                    const next = [...h, json];
                    return next.length > MAX_HISTORY ? next.slice(-MAX_HISTORY) : next;
                });
            } catch (e) {
                if (!cancelled) setError(e instanceof Error ? e.message : String(e));
            }
        }
        void poll();
        const id = setInterval(poll, REFRESH_MS);
        return () => { cancelled = true; clearInterval(id); };
    }, []);

    const latest = history[history.length - 1];

    return (
        <Box sx={{
            paddingTop: spacing.pageY,
            paddingBottom: spacing.pageY,
            paddingX: spacing.pageX,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
        }}>
            <Typography
                variant="h2"
                sx={{
                    textAlign: "center",
                    fontSize: font.titleLarge,
                    fontWeight: 700,
                    color: colors.textWhite,
                    marginBottom: "30px",
                }}
            >
                Resources
            </Typography>

            <Box sx={{
                display: "flex",
                flexDirection: "column",
                gap: spacing.cardGap,
                maxWidth: "1100px",
                width: "100%",
            }}>
                <Tabs
                    value={tab}
                    onChange={(_, v) => setTab(v)}
                    textColor="inherit"
                    indicatorColor="primary"
                    sx={{ borderBottom: `1px solid ${colors.borderMuted}` }}
                >
                    <Tab value="cpu"     label="CPU"     sx={tabSx} />
                    <Tab value="network" label="Network" sx={tabSx} />
                    <Tab value="disk"    label="Disk"    sx={tabSx} />
                </Tabs>

                {error && (
                    <Typography sx={{ color: colors.statusError }}>
                        Failed to load metrics: {error}
                    </Typography>
                )}

                {!latest && !error && (
                    <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
                        <CircularProgress />
                    </Box>
                )}

                {latest && tab === "cpu"     && <CpuTab     history={history} />}
                {latest && tab === "network" && <NetworkTab history={history} />}
                {latest && tab === "disk"    && <DiskTab    history={history} />}
            </Box>
        </Box>
    );
};

const tabSx = {
    color: colors.textMuted,
    fontSize: font.label,
    fontWeight: 700,
    textTransform: "none" as const,
    "&.Mui-selected": { color: colors.textWhite },
};

// ============================================================
// Tabs
// ============================================================

function CpuTab({ history }: { history: MetricsSnapshot[] }) {
    const latest = history[history.length - 1];
    const sample = latest.sample!;

    const cpuSeries = history.map(h => h.rates.cpuBusyFrac).filter((v): v is number => v != null);
    const memSeries = history
        .map(h => h.sample ? (h.sample.mem.totalBytes - h.sample.mem.availableBytes) / h.sample.mem.totalBytes : null)
        .filter((v): v is number => v != null);

    const memUsed = sample.mem.totalBytes - sample.mem.availableBytes;
    const swapUsed = sample.mem.swapTotalBytes - sample.mem.swapFreeBytes;

    return (
        <Box sx={{ display: "flex", flexDirection: "column", gap: spacing.cardGap }}>
            <Row>
                <StatCard
                    label="CPU"
                    value={formatPercent(latest.rates.cpuBusyFrac)}
                    subtitle={`${sample.nproc} cores · uptime ${formatUptime(sample.uptime)}`}
                    sparkline={cpuSeries}
                    sparklineMax={1}
                />
                <StatCard
                    label="Load avg"
                    value={sample.load1.toFixed(2)}
                    subtitle={`5m ${sample.load5.toFixed(2)}  ·  15m ${sample.load15.toFixed(2)}`}
                />
                <StatCard
                    label="Memory"
                    value={`${formatBytes(memUsed)} / ${formatBytes(sample.mem.totalBytes)}`}
                    subtitle={
                        sample.mem.swapTotalBytes > 0
                            ? `swap ${formatBytes(swapUsed)} / ${formatBytes(sample.mem.swapTotalBytes)}`
                            : "no swap"
                    }
                    sparkline={memSeries}
                    sparklineMax={1}
                    extra={<UsageBar used={memUsed} total={sample.mem.totalBytes} />}
                />
            </Row>
            <Section title="Top processes">
                <ProcessTable processes={sample.topProcesses} />
            </Section>
        </Box>
    );
}

function NetworkTab({ history }: { history: MetricsSnapshot[] }) {
    const latest = history[history.length - 1];
    const sample = latest.sample!;

    // Interfaces present in the latest sample. Stable order from the sample itself.
    const ifaces = sample.nets.map(n => n.iface).filter(i => !isVirtualInterface(i));

    return (
        <Box sx={{ display: "flex", flexDirection: "column", gap: spacing.cardGap }}>
            {ifaces.map(iface => {
                const net = sample.nets.find(n => n.iface === iface)!;
                const rxSeries = history.map(h => h.rates.netRxBps[iface]).filter((v): v is number => v != null);
                const txSeries = history.map(h => h.rates.netTxBps[iface]).filter((v): v is number => v != null);
                return (
                    <Section key={iface} title={iface}>
                        <Row>
                            <StatCard
                                label="Download"
                                value={formatRate(latest.rates.netRxBps[iface] ?? 0)}
                                subtitle={`total ${formatBytes(net.rxBytes)}`}
                                sparkline={rxSeries}
                                accent={colors.statusInfo}
                            />
                            <StatCard
                                label="Upload"
                                value={formatRate(latest.rates.netTxBps[iface] ?? 0)}
                                subtitle={`total ${formatBytes(net.txBytes)}`}
                                sparkline={txSeries}
                                accent={colors.statusSuccess}
                            />
                        </Row>
                    </Section>
                );
            })}
            <Section title="Network speed test">
                <BenchmarkButton
                    label="Run network speed test"
                    endpoint="/api/admin/resources/network-test"
                    warning="This will briefly use your internet bandwidth."
                    renderResult={(r: NetworkTestResult) => (
                        <BenchmarkResult
                            left={{
                                label: "↓ Download",
                                value: formatMbps(r.downloadBps),
                                sub: `${formatSeconds(r.downloadSeconds)} · ${formatBytes(r.sizeBytes)}`,
                                accent: colors.statusInfo,
                            }}
                            right={{
                                label: "↑ Upload",
                                value: formatMbps(r.uploadBps),
                                sub: `${formatSeconds(r.uploadSeconds)} · ${formatBytes(r.sizeBytes)}`,
                                accent: colors.statusSuccess,
                            }}
                            footer={`${r.target.replace(/^https?:\/\//, "")} · ${formatRelativeTime(r.ranAt)}`}
                        />
                    )}
                />
            </Section>
        </Box>
    );
}

function DiskTab({ history }: { history: MetricsSnapshot[] }) {
    const latest = history[history.length - 1];
    const sample = latest.sample!;

    const allDevices = sample.disks.map(d => d.device);
    const devices = allDevices.filter(d => !isPartition(d, allDevices));

    return (
        <Box sx={{ display: "flex", flexDirection: "column", gap: spacing.cardGap }}>
            {devices.map(device => {
                const readSeries  = history.map(h => h.rates.diskReadBps[device]).filter((v): v is number => v != null);
                const writeSeries = history.map(h => h.rates.diskWriteBps[device]).filter((v): v is number => v != null);
                return (
                    <Section key={device} title={device}>
                        <Row>
                            <StatCard
                                label="Read"
                                value={formatRate(latest.rates.diskReadBps[device] ?? 0)}
                                sparkline={readSeries}
                                accent={colors.statusInfo}
                            />
                            <StatCard
                                label="Write"
                                value={formatRate(latest.rates.diskWriteBps[device] ?? 0)}
                                sparkline={writeSeries}
                                accent={colors.statusSuccess}
                            />
                        </Row>
                    </Section>
                );
            })}
            <Section title="Filesystems">
                <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    {sample.filesystems.map(fs => (
                        <FilesystemRow key={fs.target} fs={fs} />
                    ))}
                </Box>
            </Section>
            <Section title="Disk benchmark">
                <BenchmarkButton
                    label="Run disk benchmark"
                    endpoint="/api/admin/resources/disk-test"
                    warning="This will briefly saturate disk IO. Avoid during heavy use."
                    renderResult={(r: DiskTestResult) => (
                        <BenchmarkResult
                            left={{
                                label: "Read",
                                value: formatRate(r.readBps),
                                sub: `${formatSeconds(r.readSeconds)} · ${formatBytes(r.sizeBytes)}`,
                                accent: colors.statusInfo,
                            }}
                            right={{
                                label: "Write",
                                value: formatRate(r.writeBps),
                                sub: `${formatSeconds(r.writeSeconds)} · ${formatBytes(r.sizeBytes)}`,
                                accent: colors.statusSuccess,
                            }}
                            footer={`${r.target} · ${formatRelativeTime(r.ranAt)}`}
                        />
                    )}
                />
            </Section>
        </Box>
    );
}

// ============================================================
// Reusable building blocks
// ============================================================

function Row({ children }: { children: React.ReactNode }) {
    return (
        <Box sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", md: "repeat(auto-fit, minmax(260px, 1fr))" },
            gap: 2,
        }}>
            {children}
        </Box>
    );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <Box sx={{
            border: `1px solid ${colors.borderMuted}`,
            borderRadius: "8px",
            p: spacing.cardPadding,
            display: "flex",
            flexDirection: "column",
            gap: 2,
        }}>
            <Typography sx={{ fontSize: font.title, fontWeight: 700, color: colors.textWhite }}>
                {title}
            </Typography>
            {children}
        </Box>
    );
}

function StatCard({
    label, value, subtitle, sparkline, sparklineMax, accent, extra,
}: {
    label: string;
    value: string;
    subtitle?: string;
    sparkline?: number[];
    sparklineMax?: number;
    accent?: string;
    extra?: React.ReactNode;
}) {
    const color = accent ?? colors.primary;
    return (
        <Box sx={{
            border: `1px solid ${colors.borderMuted}`,
            borderRadius: "8px",
            p: 2,
            display: "flex",
            flexDirection: "column",
            gap: 1,
            backgroundColor: colors.bgCard,
        }}>
            <Typography sx={{
                fontSize: font.caption,
                color: colors.textSubtle,
                textTransform: "uppercase",
                letterSpacing: "1px",
            }}>
                {label}
            </Typography>
            <Typography sx={{ fontSize: "28px", fontWeight: 700, color: colors.textWhite, lineHeight: 1.1 }}>
                {value}
            </Typography>
            {subtitle && (
                <Typography sx={{ fontSize: font.detail, color: colors.textMuted }}>
                    {subtitle}
                </Typography>
            )}
            {sparkline && sparkline.length > 1 && (
                <Box sx={{ mt: 1 }}>
                    <Sparkline values={sparkline} color={color} max={sparklineMax} />
                </Box>
            )}
            {extra && <Box sx={{ mt: 1 }}>{extra}</Box>}
        </Box>
    );
}

function Sparkline({
    values, color, max, width = 240, height = 40,
}: {
    values: number[];
    color: string;
    max?: number;
    width?: number;
    height?: number;
}) {
    if (values.length < 2) return null;
    const lo = 0;
    const hi = Math.max(max ?? 0, ...values, 1e-9);
    const range = hi - lo || 1;
    const n = values.length;
    const points = values.map((v, i) => {
        const x = (i / (n - 1)) * width;
        const y = height - ((v - lo) / range) * height;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    const areaPoints = `0,${height} ${points.join(" ")} ${width},${height}`;
    const linePoints = points.join(" ");
    return (
        <svg
            width="100%"
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            preserveAspectRatio="none"
            style={{ display: "block" }}
        >
            <polyline points={areaPoints} fill={color} fillOpacity={0.15} stroke="none" />
            <polyline points={linePoints} fill="none" stroke={color} strokeWidth={1.5}
                      strokeLinejoin="round" strokeLinecap="round" />
        </svg>
    );
}

function UsageBar({ used, total, color }: { used: number; total: number; color?: string }) {
    const frac = total > 0 ? Math.max(0, Math.min(1, used / total)) : 0;
    const barColor = color ?? (frac > 0.9 ? colors.statusError : frac > 0.75 ? colors.statusWarning : colors.primary);
    return (
        <Box sx={{
            width: "100%",
            height: "6px",
            borderRadius: "3px",
            backgroundColor: colors.bgInput,
            overflow: "hidden",
        }}>
            <Box sx={{
                width: `${frac * 100}%`,
                height: "100%",
                backgroundColor: barColor,
                transition: "width 0.5s ease",
            }} />
        </Box>
    );
}

function FilesystemRow({ fs }: { fs: Sample["filesystems"][number] }) {
    const frac = fs.sizeBytes > 0 ? fs.usedBytes / fs.sizeBytes : 0;
    return (
        <Box>
            <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.5 }}>
                <Typography sx={{ fontSize: font.detail, color: colors.textWhite, fontWeight: 700 }}>
                    {fs.target}
                </Typography>
                <Typography sx={{ fontSize: font.detail, color: colors.textMuted }}>
                    {formatBytes(fs.usedBytes)} / {formatBytes(fs.sizeBytes)}
                    <Box component="span" sx={{ color: colors.textSubtle, ml: 1 }}>
                        ({(frac * 100).toFixed(0)}%)
                    </Box>
                </Typography>
            </Box>
            <UsageBar used={fs.usedBytes} total={fs.sizeBytes} />
            <Typography sx={{ fontSize: font.caption, color: colors.textSubtle, mt: 0.5 }}>
                {fs.source}
            </Typography>
        </Box>
    );
}

function ProcessTable({ processes }: { processes: Sample["topProcesses"] }) {
    return (
        <Box sx={{ display: "table", width: "100%", borderCollapse: "collapse" }}>
            <Box sx={{ display: "table-row" }}>
                {["PID", "USER", "CPU%", "MEM%", "COMMAND"].map((h, i) => (
                    <Box key={h} sx={{
                        display: "table-cell",
                        fontSize: font.caption,
                        color: colors.textSubtle,
                        textTransform: "uppercase",
                        letterSpacing: "1px",
                        py: 1,
                        px: i === 0 ? 0 : 2,
                        borderBottom: `1px solid ${colors.borderMuted}`,
                    }}>
                        {h}
                    </Box>
                ))}
            </Box>
            {processes.map((p, idx) => (
                <Box key={`${p.pid}-${idx}`} sx={{ display: "table-row" }}>
                    <Cell>{p.pid}</Cell>
                    <Cell muted>{p.user}</Cell>
                    <Cell>{p.cpuPct.toFixed(1)}</Cell>
                    <Cell>{p.memPct.toFixed(1)}</Cell>
                    <Cell mono>{p.comm}</Cell>
                </Box>
            ))}
        </Box>
    );
}

function Cell({ children, muted, mono }: { children: React.ReactNode; muted?: boolean; mono?: boolean }) {
    return (
        <Box sx={{
            display: "table-cell",
            fontSize: font.detail,
            color: muted ? colors.textMuted : colors.textWhite,
            py: 1,
            px: 2,
            fontFamily: mono ? "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" : undefined,
        }}>
            {children}
        </Box>
    );
}

function BenchmarkButton<T>({
    label, endpoint, warning, renderResult,
}: {
    label: string;
    endpoint: string;
    warning: string;
    renderResult?: (result: T) => React.ReactNode;
}) {
    const [running, setRunning] = useState(false);
    const [result, setResult] = useState<T | null>(null);
    const [error, setError] = useState<string | null>(null);

    async function run() {
        setRunning(true);
        setError(null);
        setResult(null);
        try {
            setResult(await apiRequest<T>(endpoint, "POST"));
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setRunning(false);
        }
    }

    return (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
            <Typography sx={{ fontSize: font.caption, color: colors.textSubtle }}>
                {warning}
            </Typography>
            <Button
                variant="contained"
                color="primary"
                onClick={run}
                disabled={running}
                sx={{ alignSelf: "flex-start" }}
            >
                {running ? "Running…" : label}
            </Button>
            {error && (
                <Typography sx={{ color: colors.statusError, fontSize: font.detail }}>
                    {error}
                </Typography>
            )}
            {result !== null && (
                renderResult
                    ? renderResult(result)
                    : (
                        <Box component="pre" sx={{
                            fontSize: font.caption,
                            color: colors.textMuted,
                            backgroundColor: colors.bgInput,
                            borderRadius: "8px",
                            p: 2,
                            overflowX: "auto",
                            margin: 0,
                        }}>
                            {JSON.stringify(result, null, 2)}
                        </Box>
                    )
            )}
        </Box>
    );
}

function BenchmarkResult({
    left, right, footer,
}: {
    left: { label: string; value: string; sub: string; accent: string };
    right: { label: string; value: string; sub: string; accent: string };
    footer: string;
}) {
    return (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
            <Box sx={{
                display: "grid",
                gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
                gap: 2,
            }}>
                <BenchmarkResultCell {...left} />
                <BenchmarkResultCell {...right} />
            </Box>
            <Typography sx={{
                fontSize: font.caption,
                color: colors.textSubtle,
                textAlign: "right",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            }}>
                {footer}
            </Typography>
        </Box>
    );
}

function BenchmarkResultCell({
    label, value, sub, accent,
}: { label: string; value: string; sub: string; accent: string }) {
    return (
        <Box sx={{
            border: `1px solid ${colors.borderMuted}`,
            borderRadius: "8px",
            p: 2,
            display: "flex",
            flexDirection: "column",
            gap: 0.5,
            backgroundColor: colors.bgCard,
            borderLeft: `3px solid ${accent}`,
        }}>
            <Typography sx={{
                fontSize: font.caption,
                color: colors.textSubtle,
                textTransform: "uppercase",
                letterSpacing: "1px",
            }}>
                {label}
            </Typography>
            <Typography sx={{ fontSize: "28px", fontWeight: 700, color: colors.textWhite, lineHeight: 1.1 }}>
                {value}
            </Typography>
            <Typography sx={{ fontSize: font.detail, color: colors.textMuted }}>
                {sub}
            </Typography>
        </Box>
    );
}
