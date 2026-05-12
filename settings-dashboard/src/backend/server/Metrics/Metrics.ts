import { executeHostCommand } from "@/backend/cmd/HostExecutor";

const REFRESH_INTERVAL_MS = 5 * 1000;

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

// ============================================================
// State
// ============================================================

let previous: RawSample | null = null;
let snapshot: MetricsSnapshot = {
    sample: null,
    rates: { cpuBusyFrac: null, diskReadBps: {}, diskWriteBps: {}, netRxBps: {}, netTxBps: {} },
    lastRefreshedAt: null,
    lastError: null,
};
let refreshTimer: NodeJS.Timeout | null = null;

const SECTOR_BYTES = 512;

// ============================================================
// Public API
// ============================================================

export function getMetricsSnapshot(): MetricsSnapshot {
    return snapshot;
}

export async function refreshMetricsSnapshot(): Promise<void> {
    try {
        const result = await executeHostCommand(COLLECT_SCRIPT);
        const current = parse(result.stdout || "", Date.now());
        const rates = previous ? computeRates(previous, current) : emptyRates();
        snapshot = {
            sample: current,
            rates,
            lastRefreshedAt: new Date().toISOString(),
            lastError: null,
        };
        previous = current;
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.warn("Metrics: failed to refresh from host:", msg);
        snapshot = { ...snapshot, lastError: msg };
    }
}

export function startMetricsRefresh(): void {
    if (refreshTimer) return;
    void refreshMetricsSnapshot();
    refreshTimer = setInterval(() => void refreshMetricsSnapshot(), REFRESH_INTERVAL_MS);
    refreshTimer.unref?.();
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
