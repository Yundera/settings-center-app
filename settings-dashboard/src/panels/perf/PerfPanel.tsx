import React, { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import { colors, font, spacing } from "@/app/pages/softTheme";

const REFRESH_MS = 5000;

type MetricsSnapshot = unknown; // wire to backend type once Metrics.ts shape is final

/**
 * Perf panel — VM metrics + on-demand benchmarks.
 *
 * V1 scaffold:
 *   - polls /api/admin/metrics every 5s
 *   - renders raw JSON inside each tab as a placeholder until the chart
 *     components are designed
 *   - benchmark buttons POST to stub endpoints (network-test, disk-test)
 *
 * Replace the <pre> blocks with real visualisations once Metrics.ts emits
 * a stable shape verified against a live PCS.
 */
export const PerfPanel = () => {
    const [tab, setTab] = useState<"network" | "disk" | "cpu">("network");
    const [snapshot, setSnapshot] = useState<MetricsSnapshot | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        async function poll() {
            try {
                const res = await fetch("/api/admin/metrics", {
                    headers: authHeaders(),
                });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const json = await res.json();
                if (!cancelled) {
                    setSnapshot(json);
                    setError(null);
                }
            } catch (e) {
                if (!cancelled) {
                    setError(e instanceof Error ? e.message : String(e));
                }
            }
        }
        void poll();
        const id = setInterval(poll, REFRESH_MS);
        return () => {
            cancelled = true;
            clearInterval(id);
        };
    }, []);

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
                Performance
            </Typography>

            <Box sx={{
                display: "flex",
                flexDirection: "column",
                gap: spacing.cardGap,
                maxWidth: "1000px",
                width: "100%",
            }}>
                <Tabs
                    value={tab}
                    onChange={(_, v) => setTab(v)}
                    textColor="inherit"
                    indicatorColor="primary"
                    sx={{ borderBottom: `1px solid ${colors.borderMuted}` }}
                >
                    <Tab value="network" label="Network" sx={tabSx} />
                    <Tab value="disk"    label="Disk"    sx={tabSx} />
                    <Tab value="cpu"     label="CPU"     sx={tabSx} />
                </Tabs>

                {error && (
                    <Typography sx={{ color: colors.statusError }}>
                        Failed to load metrics: {error}
                    </Typography>
                )}

                {!snapshot && !error && (
                    <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
                        <CircularProgress />
                    </Box>
                )}

                {snapshot && tab === "network" && <NetworkTab snapshot={snapshot} />}
                {snapshot && tab === "disk"    && <DiskTab    snapshot={snapshot} />}
                {snapshot && tab === "cpu"     && <CpuTab     snapshot={snapshot} />}
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

function NetworkTab({ snapshot }: { snapshot: MetricsSnapshot }) {
    return (
        <Section title="Network">
            <RawJson value={snapshot} />
            <BenchmarkButton
                label="Run network speed test"
                endpoint="/api/admin/perf/network-test"
                warning="This will briefly use your internet bandwidth."
            />
        </Section>
    );
}

function DiskTab({ snapshot }: { snapshot: MetricsSnapshot }) {
    return (
        <Section title="Disk">
            <RawJson value={snapshot} />
            <BenchmarkButton
                label="Run disk benchmark"
                endpoint="/api/admin/perf/disk-test"
                warning="This will briefly saturate disk IO. Avoid during heavy use."
            />
        </Section>
    );
}

function CpuTab({ snapshot }: { snapshot: MetricsSnapshot }) {
    return (
        <Section title="CPU">
            <RawJson value={snapshot} />
        </Section>
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

function RawJson({ value }: { value: unknown }) {
    return (
        <Box component="pre" sx={{
            fontSize: font.caption,
            color: colors.textMuted,
            backgroundColor: colors.bgInput,
            borderRadius: "8px",
            p: 2,
            overflowX: "auto",
            margin: 0,
        }}>
            {JSON.stringify(value, null, 2)}
        </Box>
    );
}

function BenchmarkButton({
    label, endpoint, warning,
}: { label: string; endpoint: string; warning: string }) {
    const [running, setRunning] = useState(false);
    const [result, setResult] = useState<unknown>(null);
    const [error, setError] = useState<string | null>(null);

    async function run() {
        setRunning(true);
        setError(null);
        setResult(null);
        try {
            const res = await fetch(endpoint, {
                method: "POST",
                headers: authHeaders(),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            setResult(await res.json());
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
            {result !== null && <RawJson value={result} />}
        </Box>
    );
}

function authHeaders(): Record<string, string> {
    // Match the auth pattern used by other admin routes — token stored
    // client-side by the local auth provider. If your provider exposes
    // this differently, swap the lookup here.
    if (typeof window === "undefined") return {};
    const token = window.localStorage.getItem("token");
    return token ? { Authorization: `Bearer ${token}` } : {};
}
