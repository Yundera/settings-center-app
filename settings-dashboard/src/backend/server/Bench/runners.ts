import { executeHostCommand } from "@/backend/cmd/HostExecutor";

// Shared bench runners.
//
// The disk and network benchmarks were originally inlined in their admin
// endpoints. They are now extracted here so the public `/api/bench/*`
// endpoints can share a single implementation behind the BenchCache
// single-flight wrapper — the admin endpoints still call them directly for
// on-demand refresh.

// ─── Disk bench ────────────────────────────────────────────────────────

const DISK_SCRATCH_PATH = "/DATA/.bench.tmp";
const DISK_SIZE_MB = 256;
const DISK_SIZE_BYTES = DISK_SIZE_MB * 1024 * 1024;
const DISK_TIMEOUT_MS = 90_000;

export interface DiskTestResult {
    writeBps: number;
    readBps: number;
    writeSeconds: number;
    readSeconds: number;
    sizeBytes: number;
    target: string;
    ranAt: string;
}

// dd reports throughput on its stderr like:
//   268435456 bytes (268 MB, 256 MiB) copied, 1.23456 s, 217 MB/s
// The "(268 MB, 256 MiB)" middle group contains a comma, so a naive single
// regex with [^,]* would stop there. We grab bytes and seconds independently
// and compute Bps ourselves to avoid mixing MB/MiB/GB unit reporting.
function parseDdOutput(output: string): { bytes: number; seconds: number; bps: number } {
    const bytesMatch = output.match(/(\d+)\s+bytes\b/);
    const secondsMatch = output.match(/copied,\s*([\d.eE+-]+)\s*s/);
    if (!bytesMatch || !secondsMatch) {
        throw new Error(`Unexpected dd output: ${output.slice(0, 200)}`);
    }
    const bytes = parseInt(bytesMatch[1], 10);
    const seconds = parseFloat(secondsMatch[1]);
    if (!Number.isFinite(bytes) || !Number.isFinite(seconds) || seconds <= 0) {
        throw new Error(`Bad dd parse: bytes=${bytes} seconds=${seconds}`);
    }
    return { bytes, seconds, bps: bytes / seconds };
}

export async function runDiskBench(): Promise<DiskTestResult> {
    // Scratch file lives on the user-data partition so we measure the disk
    // users actually care about. /DATA is root-owned, so we run the benchmark
    // under `sudo -n` — the same NOPASSWD path self-check-run uses. 256 MiB
    // is large enough to exceed kernel readahead/coalescing windows so the
    // SSD's actual sustained throughput dominates, small enough to keep the
    // test under ~5 s on slow hardware.
    const script = `
set -u
BENCH_FILE=${DISK_SCRATCH_PATH}
trap 'sudo -n rm -f "$BENCH_FILE"' EXIT
echo "===WRITE==="
sudo -n dd if=/dev/zero of="$BENCH_FILE" bs=1M count=${DISK_SIZE_MB} oflag=direct conv=fdatasync 2>&1
echo "===READ==="
sudo -n dd if="$BENCH_FILE" of=/dev/null bs=1M iflag=direct 2>&1
echo "===END==="
`;

    const result = await executeHostCommand(script, { timeout: DISK_TIMEOUT_MS });
    const out = result.stdout || "";
    const writeBlock = out.split("===WRITE===")[1]?.split("===READ===")[0] || "";
    const readBlock  = out.split("===READ===")[1]?.split("===END===")[0]   || "";

    const write = parseDdOutput(writeBlock);
    const read  = parseDdOutput(readBlock);

    return {
        writeBps: write.bps,
        readBps:  read.bps,
        writeSeconds: write.seconds,
        readSeconds:  read.seconds,
        sizeBytes: DISK_SIZE_BYTES,
        target: DISK_SCRATCH_PATH,
        ranAt: new Date().toISOString(),
    };
}

// ─── Network bench ─────────────────────────────────────────────────────

// 25 MiB. Big enough that link speed dominates over connection overhead on
// any sensible PCS uplink, small enough that the test completes in seconds.
const NET_SIZE_BYTES = 25 * 1024 * 1024;
const NET_TARGET = "https://speed.cloudflare.com";
const NET_TIMEOUT_MS = 75_000;

export interface NetworkTestResult {
    downloadBps: number;
    uploadBps: number;
    downloadSeconds: number;
    uploadSeconds: number;
    sizeBytes: number;
    target: string;
    ranAt: string;
}

function parseCurlOutput(stdout: string): { seconds: number; bps: number } {
    const m = stdout.trim().match(/^([\d.]+)\s+([\d.]+)$/);
    if (!m) throw new Error(`Unexpected curl output: ${stdout.slice(0, 120)}`);
    return { seconds: parseFloat(m[1]), bps: parseFloat(m[2]) };
}

export async function runNetworkBench(): Promise<NetworkTestResult> {
    const downCmd =
        `curl -fsS -o /dev/null -w '%{time_total} %{speed_download}' ` +
        `--max-time 60 '${NET_TARGET}/__down?bytes=${NET_SIZE_BYTES}'`;
    const upCmd =
        `head -c ${NET_SIZE_BYTES} /dev/urandom | ` +
        `curl -fsS -o /dev/null -w '%{time_total} %{speed_upload}' ` +
        `--max-time 60 -X POST --data-binary @- ` +
        `-H 'Content-Type: application/octet-stream' '${NET_TARGET}/__up'`;

    // Sequential rather than parallel — running upload and download at the
    // same time would have them compete for the same link and underreport
    // both.
    const downRes = await executeHostCommand(downCmd, { timeout: NET_TIMEOUT_MS });
    const down = parseCurlOutput(downRes.stdout);
    const upRes = await executeHostCommand(upCmd, { timeout: NET_TIMEOUT_MS });
    const up = parseCurlOutput(upRes.stdout);

    return {
        downloadBps: down.bps,
        uploadBps: up.bps,
        downloadSeconds: down.seconds,
        uploadSeconds: up.seconds,
        sizeBytes: NET_SIZE_BYTES,
        target: NET_TARGET,
        ranAt: new Date().toISOString(),
    };
}
