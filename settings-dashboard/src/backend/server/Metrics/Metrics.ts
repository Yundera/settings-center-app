import { executeHostCommand } from "@/backend/cmd/HostExecutor";

// ============================================================
// Sampling cadence
// ============================================================
//
// The loop runs forever so metric history keeps accumulating, but it samples
// slowly when nobody is watching and fast while the Resources panel is open.
//
// A previous version used a fixed 5 s `setInterval` that never waited for the
// prior cycle to finish. Under host load an SSH cycle could take longer than
// 5 s, so cycles overlapped — and with no command timeout, hung `ssh`/`bash`/
// `ps` process trees accumulated on the host until CPU ran away. This loop is
// a self-rescheduling `setTimeout` chain: the next cycle is armed only AFTER
// the current one fully settles, so cycles can never overlap.

const SLOW_INTERVAL_MS = 5 * 60 * 1000;   // baseline cadence when the dashboard is idle
const FAST_INTERVAL_MS = 5 * 1000;        // cadence while the dashboard is actively polling

// The dashboard counts as "active" if /api/admin/metrics was read within this
// window. Kept comfortably above the frontend's 5 s poll so a single dropped
// poll doesn't bounce the loop back to the slow cadence.
const ACTIVE_WINDOW_MS = 20 * 1000;

// Hard wall-clock budget for one host round-trip. executeHostCommand passes
// this to the local executor, which SIGKILLs the ssh process tree if exceeded
// — a cycle that cannot finish in time dies instead of lingering.
const COLLECT_TIMEOUT_MS = 15 * 1000;

// Adaptive backoff: when a cycle takes longer than this fraction of the
// timeout budget, the host is probably under load. The next delay is stretched
// proportionally (see computeNextDelay) so we don't pile more SSH load onto a
// sick host, while still updating the UI often enough to be useful.
const STRESS_THRESHOLD_MS = COLLECT_TIMEOUT_MS / 2;   // 7.5 s
// Cap for the stressed-active delay. Stays well below SLOW_INTERVAL_MS so a
// user actively watching the panel still gets refreshes within a minute even
// when the host is struggling.
const MAX_ACTIVE_BACKOFF_MS = 60 * 1000;              // 60 s

// History ring buffer bounds — trimmed by both age and entry count.
const HISTORY_WINDOW_MS = 12 * 60 * 60 * 1000;  // keep up to 12 h of points
const HISTORY_MAX_ENTRIES = 720;                // hard cap on RAM / response size

/**
 * Single bash payload that gathers every metric in one SSH round-trip.
 * Sections are framed with `===NAME===` so the Node parser can split cheaply
 * on those markers.
 *
 * TUNING NEEDED on a real PCS:
 *   - confirm `nproc`, `ps`, `df`, `awk` are present on the host (they are
 *     on the Yundera Ubuntu host image, but verify before relying on them)
 *   - decide which mounts to include in the df filter (currently excludes
 *     tmpfs/devtmpfs/overlay/squashfs)
 *   - confirm the network interface naming you actually want to track
 *     (eth0/ens18/wg* etc.)
 */
const COLLECT_SCRIPT = `
echo "===UPTIME==="
cat /proc/uptime
echo "===LOADAVG==="
cat /proc/loadavg
echo "===NPROC==="
nproc
echo "===MEMINFO==="
grep -E "^(MemTotal|MemFree|MemAvailable|Buffers|Cached|SwapTotal|SwapFree):" /proc/meminfo
echo "===STAT==="
head -1 /proc/stat
echo "===DISKSTATS==="
cat /proc/diskstats
echo "===NETDEV==="
cat /proc/net/dev
echo "===DF==="
df -B1 -x tmpfs -x devtmpfs -x overlay -x squashfs --output=source,target,size,used,avail
echo "===TOP==="
ps -eo pid,user,pcpu,pmem,comm --sort=-pcpu --no-headers | head -10
`;

// ============================================================
// Types
// ============================================================

export interface CpuStat {
    user: number; nice: number; system: number; idle: number;
    iowait: number; irq: number; softirq: number; steal: number;
}

export interface DiskStat {
    device: string;
    readsCompleted: number;
    sectorsRead: number;
    writesCompleted: number;
    sectorsWritten: number;
}

export interface NetIfStat {
    iface: string;
    rxBytes: number;
    txBytes: number;
}

export interface RawSample {
    /** seconds since boot (from /proc/uptime field 1) */
    uptime: number;
    /** ms since unix epoch when this sample was collected */
    sampledAt: number;
    load1: number; load5: number; load15: number;
    nproc: number;
    mem: {
        totalBytes: number; freeBytes: number; availableBytes: number;
        buffersBytes: number; cachedBytes: number;
        swapTotalBytes: number; swapFreeBytes: number;
    };
    cpu: CpuStat;
    disks: DiskStat[];
    nets: NetIfStat[];
    filesystems: { source: string; target: string; sizeBytes: number; usedBytes: number; availBytes: number }[];
    topProcesses: { pid: number; user: string; cpuPct: number; memPct: number; comm: string }[];
}

export interface MetricsSnapshot {
    sample: RawSample | null;
    /** derived from the delta between the previous and current sample */
    rates: {
        /** 0..1 — fraction of all-cores busy time over the delta window */
        cpuBusyFrac: number | null;
        /** per-disk bytes/sec, keyed by device name */
        diskReadBps: Record<string, number>;
        diskWriteBps: Record<string, number>;
        /** per-interface bytes/sec, keyed by interface name */
        netRxBps: Record<string, number>;
        netTxBps: Record<string, number>;
    };
    lastRefreshedAt: string | null;
    lastError: string | null;
}

/**
 * Slim historical point kept in the ring buffer. Carries only what the graphs
 * plot — deliberately NOT the full sample (process list, filesystems), so the
 * buffer stays small in RAM and cheap to ship to the browser every poll.
 */
export interface MetricsHistoryPoint {
    /** ms since unix epoch */
    sampledAt: number;
    cpuBusyFrac: number | null;
    /** memory used fraction, 0..1 */
    memUsedFrac: number;
    load1: number;
    netRxBps: Record<string, number>;
    netTxBps: Record<string, number>;
    diskReadBps: Record<string, number>;
    diskWriteBps: Record<string, number>;
}

/** Shape returned by GET /api/admin/metrics. */
export interface MetricsResponse {
    /** Full latest snapshot — powers the detail cards, process table, filesystems. */
    current: MetricsSnapshot;
    /** Slim historical points for the graphs, oldest first. */
    history: MetricsHistoryPoint[];
}

// ============================================================
// State
// ============================================================

// Pinned to globalThis because Next.js dev mode compiles API routes through
// its own bundler and gives them a separate module instance from the one
// loaded by tsx for server.ts. Module-level `let`s end up duplicated: the
// background refresh writes to the tsx copy, while /api/admin/metrics reads
// from a pristine route copy. globalThis is the single process-wide object
// both copies share.
const STATE_KEY = "__yundera_metrics_state__" as const;

interface MetricsState {
    previous: RawSample | null;
    snapshot: MetricsSnapshot;
    history: MetricsHistoryPoint[];
    refreshTimer: NodeJS.Timeout | null;
    /** true while a refresh cycle is running — guards against double-arming */
    inFlight: boolean;
    /** ms epoch of the last /api/admin/metrics read */
    lastReadAt: number;
    /** true once startMetricsRefresh has armed the loop */
    started: boolean;
}

function getState(): MetricsState {
    const g = globalThis as unknown as Record<string, MetricsState | undefined>;
    let s = g[STATE_KEY];
    if (!s) {
        s = {
            previous: null,
            snapshot: {
                sample: null,
                rates: { cpuBusyFrac: null, diskReadBps: {}, diskWriteBps: {}, netRxBps: {}, netTxBps: {} },
                lastRefreshedAt: null,
                lastError: null,
            },
            history: [],
            refreshTimer: null,
            inFlight: false,
            lastReadAt: 0,
            started: false,
        };
        g[STATE_KEY] = s;
    } else {
        // Backfill fields on a state object left behind by an older module
        // version (Next.js dev hot-reload) so callers never hit `undefined`.
        s.history ??= [];
        s.inFlight ??= false;
        s.lastReadAt ??= 0;
        s.started ??= false;
    }
    return s;
}

const SECTOR_BYTES = 512;

// ============================================================
// Public API
// ============================================================

/** Full response for GET /api/admin/metrics — latest snapshot + history buffer. */
export function getMetricsResponse(): MetricsResponse {
    const s = getState();
    return { current: s.snapshot, history: s.history };
}

/**
 * Record that a client just read the metrics endpoint. Flips the sampling loop
 * to the fast cadence and, on an idle→active transition, pulls the next
 * refresh forward so the graph starts updating immediately instead of waiting
 * out the 5-minute baseline timer.
 */
export function notifyMetricsRead(): void {
    const state = getState();
    const wasActive = isActive(state);
    state.lastReadAt = Date.now();

    // Only nudge on the idle→active edge, and only when no cycle is running
    // (a running cycle's own reschedule will already see the fresh lastReadAt
    // and pick the fast cadence).
    if (!wasActive && !state.inFlight && state.refreshTimer) {
        clearTimeout(state.refreshTimer);
        state.refreshTimer = setTimeout(() => void runRefreshCycle(), 0);
        state.refreshTimer.unref?.();
    }
}

function isActive(state: MetricsState): boolean {
    return Date.now() - state.lastReadAt < ACTIVE_WINDOW_MS;
}

/**
 * Run one host round-trip and update the snapshot + history. Never throws —
 * SSH failures are swallowed and the previous snapshot is kept.
 */
export async function refreshMetricsSnapshot(): Promise<void> {
    const state = getState();
    try {
        const result = await executeHostCommand(COLLECT_SCRIPT, { timeout: COLLECT_TIMEOUT_MS });
        const current = parse(result.stdout || "", Date.now());
        const rates = state.previous ? computeRates(state.previous, current) : emptyRates();
        state.snapshot = {
            sample: current,
            rates,
            lastRefreshedAt: new Date().toISOString(),
            lastError: null,
        };
        state.previous = current;
        appendHistory(state, current, rates);
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.warn("Metrics: failed to refresh from host:", msg);
        state.snapshot = { ...state.snapshot, lastError: msg };
    }
}

/** Append a slim point to the ring buffer and trim it by age and count. */
function appendHistory(state: MetricsState, sample: RawSample, rates: MetricsSnapshot["rates"]): void {
    const memUsedFrac = sample.mem.totalBytes > 0
        ? (sample.mem.totalBytes - sample.mem.availableBytes) / sample.mem.totalBytes
        : 0;
    state.history.push({
        sampledAt: sample.sampledAt,
        cpuBusyFrac: rates.cpuBusyFrac,
        memUsedFrac,
        load1: sample.load1,
        netRxBps: rates.netRxBps,
        netTxBps: rates.netTxBps,
        diskReadBps: rates.diskReadBps,
        diskWriteBps: rates.diskWriteBps,
    });
    const cutoff = Date.now() - HISTORY_WINDOW_MS;
    while (state.history.length > 0 && state.history[0].sampledAt < cutoff) {
        state.history.shift();
    }
    if (state.history.length > HISTORY_MAX_ENTRIES) {
        state.history.splice(0, state.history.length - HISTORY_MAX_ENTRIES);
    }
}

/**
 * One iteration of the sampling loop: refresh, then arm the next iteration.
 * The next `setTimeout` is created only after the refresh settles, so two
 * cycles can never run concurrently.
 */
async function runRefreshCycle(): Promise<void> {
    const state = getState();
    state.inFlight = true;
    const startedAt = Date.now();
    try {
        await refreshMetricsSnapshot();
    } finally {
        const durationMs = Date.now() - startedAt;
        state.inFlight = false;
        const delay = computeNextDelay(state, durationMs);
        state.refreshTimer = setTimeout(() => void runRefreshCycle(), delay);
        state.refreshTimer.unref?.();
    }
}

/**
 * Pick the next refresh delay based on whether the dashboard is being watched
 * and how long the last cycle took. A cycle that used >50 % of the timeout
 * budget — including one that timed out outright — triggers proportional
 * backoff, capped so the UI doesn't stall when a user is actively viewing.
 */
function computeNextDelay(state: MetricsState, lastDurationMs: number): number {
    if (!isActive(state)) {
        return SLOW_INTERVAL_MS;
    }
    if (lastDurationMs > STRESS_THRESHOLD_MS) {
        return Math.min(MAX_ACTIVE_BACKOFF_MS, Math.max(FAST_INTERVAL_MS, lastDurationMs * 2));
    }
    return FAST_INTERVAL_MS;
}

/** Kick off the sampling loop. Idempotent. */
export function startMetricsRefresh(): void {
    const state = getState();
    if (state.started) return;
    state.started = true;
    void runRefreshCycle();
}

// ============================================================
// Parsing
// ============================================================

function parse(stdout: string, sampledAt: number): RawSample {
    const sections = splitSections(stdout);

    const [uptime] = (sections.UPTIME ?? "0 0").trim().split(/\s+/).map(Number);

    const [load1, load5, load15] = (sections.LOADAVG ?? "0 0 0")
        .trim().split(/\s+/).slice(0, 3).map(Number);

    const nproc = parseInt((sections.NPROC ?? "1").trim(), 10) || 1;

    const mem = parseMeminfo(sections.MEMINFO ?? "");
    const cpu = parseCpuStat(sections.STAT ?? "");
    const disks = parseDiskstats(sections.DISKSTATS ?? "");
    const nets = parseNetDev(sections.NETDEV ?? "");
    const filesystems = parseDf(sections.DF ?? "");
    const topProcesses = parseTop(sections.TOP ?? "");

    return { uptime, sampledAt, load1, load5, load15, nproc, mem, cpu, disks, nets, filesystems, topProcesses };
}

function splitSections(stdout: string): Record<string, string> {
    const out: Record<string, string> = {};
    let current: string | null = null;
    let buf: string[] = [];
    for (const line of stdout.split("\n")) {
        const m = line.match(/^===([A-Z]+)===$/);
        if (m) {
            if (current) out[current] = buf.join("\n");
            current = m[1];
            buf = [];
        } else if (current) {
            buf.push(line);
        }
    }
    if (current) out[current] = buf.join("\n");
    return out;
}

function parseMeminfo(s: string): RawSample["mem"] {
    const kv: Record<string, number> = {};
    for (const line of s.split("\n")) {
        const m = line.match(/^(\w+):\s+(\d+)\s*kB/);
        if (m) kv[m[1]] = parseInt(m[2], 10) * 1024;
    }
    return {
        totalBytes:     kv.MemTotal     ?? 0,
        freeBytes:      kv.MemFree      ?? 0,
        availableBytes: kv.MemAvailable ?? 0,
        buffersBytes:   kv.Buffers      ?? 0,
        cachedBytes:    kv.Cached       ?? 0,
        swapTotalBytes: kv.SwapTotal    ?? 0,
        swapFreeBytes:  kv.SwapFree     ?? 0,
    };
}

function parseCpuStat(s: string): CpuStat {
    // "cpu  user nice system idle iowait irq softirq steal ..."
    const parts = s.trim().split(/\s+/);
    const n = (i: number) => parseInt(parts[i] ?? "0", 10) || 0;
    return {
        user: n(1), nice: n(2), system: n(3), idle: n(4),
        iowait: n(5), irq: n(6), softirq: n(7), steal: n(8),
    };
}

function parseDiskstats(s: string): DiskStat[] {
    // Fields per `man 5 proc` /proc/diskstats:
    //   3: device name, 4: reads completed, 6: sectors read,
    //   8: writes completed, 10: sectors written
    const out: DiskStat[] = [];
    for (const line of s.split("\n")) {
        const p = line.trim().split(/\s+/);
        if (p.length < 10) continue;
        const device = p[2];
        // Skip loop/ram pseudo-devices and per-partition entries we don't need.
        if (/^(loop|ram|dm-)/.test(device)) continue;
        out.push({
            device,
            readsCompleted:  parseInt(p[3], 10) || 0,
            sectorsRead:     parseInt(p[5], 10) || 0,
            writesCompleted: parseInt(p[7], 10) || 0,
            sectorsWritten:  parseInt(p[9], 10) || 0,
        });
    }
    return out;
}

function parseNetDev(s: string): NetIfStat[] {
    // Skip the two header lines; format:
    //   iface: rx_bytes rx_packets ... tx_bytes tx_packets ...
    const out: NetIfStat[] = [];
    for (const line of s.split("\n")) {
        const m = line.match(/^\s*([^:\s]+):\s*(.*)$/);
        if (!m) continue;
        const iface = m[1];
        if (iface === "lo") continue;
        const fields = m[2].trim().split(/\s+/).map(n => parseInt(n, 10) || 0);
        if (fields.length < 16) continue;
        out.push({ iface, rxBytes: fields[0], txBytes: fields[8] });
    }
    return out;
}

function parseDf(s: string): RawSample["filesystems"] {
    const out: RawSample["filesystems"] = [];
    const lines = s.split("\n").map(l => l.trim()).filter(Boolean);
    // First line is the header (Filesystem Mounted size used avail when --output is used).
    for (const line of lines.slice(1)) {
        const p = line.split(/\s+/);
        if (p.length < 5) continue;
        out.push({
            source:    p[0],
            target:    p[1],
            sizeBytes: parseInt(p[2], 10) || 0,
            usedBytes: parseInt(p[3], 10) || 0,
            availBytes: parseInt(p[4], 10) || 0,
        });
    }
    return out;
}

function parseTop(s: string): RawSample["topProcesses"] {
    const out: RawSample["topProcesses"] = [];
    for (const line of s.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        // ps -eo pid,user,pcpu,pmem,comm --no-headers
        const p = trimmed.split(/\s+/);
        if (p.length < 5) continue;
        out.push({
            pid:     parseInt(p[0], 10) || 0,
            user:    p[1],
            cpuPct:  parseFloat(p[2]) || 0,
            memPct:  parseFloat(p[3]) || 0,
            comm:    p.slice(4).join(" "),
        });
    }
    return out;
}

// ============================================================
// Rate derivation
// ============================================================

function emptyRates(): MetricsSnapshot["rates"] {
    return { cpuBusyFrac: null, diskReadBps: {}, diskWriteBps: {}, netRxBps: {}, netTxBps: {} };
}

function computeRates(prev: RawSample, curr: RawSample): MetricsSnapshot["rates"] {
    const dtSec = Math.max((curr.sampledAt - prev.sampledAt) / 1000, 0.001);

    // CPU busy fraction: 1 - delta_idle / delta_total (across all jiffies).
    const totalPrev = sumJiffies(prev.cpu);
    const totalCurr = sumJiffies(curr.cpu);
    const dTotal = totalCurr - totalPrev;
    const dIdle  = (curr.cpu.idle + curr.cpu.iowait) - (prev.cpu.idle + prev.cpu.iowait);
    const cpuBusyFrac = dTotal > 0 ? Math.max(0, Math.min(1, 1 - dIdle / dTotal)) : null;

    const diskReadBps:  Record<string, number> = {};
    const diskWriteBps: Record<string, number> = {};
    const prevDisks = new Map(prev.disks.map(d => [d.device, d]));
    for (const d of curr.disks) {
        const p = prevDisks.get(d.device);
        if (!p) continue;
        diskReadBps[d.device]  = ((d.sectorsRead    - p.sectorsRead)    * SECTOR_BYTES) / dtSec;
        diskWriteBps[d.device] = ((d.sectorsWritten - p.sectorsWritten) * SECTOR_BYTES) / dtSec;
    }

    const netRxBps: Record<string, number> = {};
    const netTxBps: Record<string, number> = {};
    const prevNets = new Map(prev.nets.map(n => [n.iface, n]));
    for (const n of curr.nets) {
        const p = prevNets.get(n.iface);
        if (!p) continue;
        netRxBps[n.iface] = (n.rxBytes - p.rxBytes) / dtSec;
        netTxBps[n.iface] = (n.txBytes - p.txBytes) / dtSec;
    }

    return { cpuBusyFrac, diskReadBps, diskWriteBps, netRxBps, netTxBps };
}

function sumJiffies(c: CpuStat): number {
    return c.user + c.nice + c.system + c.idle + c.iowait + c.irq + c.softirq + c.steal;
}
