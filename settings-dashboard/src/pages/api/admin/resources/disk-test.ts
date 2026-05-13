import { NextApiRequest, NextApiResponse } from "next";
import { authMiddleware } from "@/backend/auth/middleware";
import { executeHostCommand } from "@/backend/cmd/HostExecutor";

// Scratch file lives on the user-data partition so we measure the disk users
// actually care about. /DATA is root-owned, so we run the benchmark under
// `sudo -n` — the same NOPASSWD path self-check-run uses. 256 MiB is large
// enough to exceed kernel readahead/coalescing windows so the SSD's actual
// sustained throughput dominates, small enough to keep the test under ~5 s
// on slow hardware.
const SCRATCH_PATH = "/DATA/.bench.tmp";
const SIZE_MB = 256;
const SIZE_BYTES = SIZE_MB * 1024 * 1024;

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

async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== "POST") {
        res.setHeader("Allow", "POST");
        return res.status(405).json({ error: "Method not allowed" });
    }

    // Run write + read sequentially, always clean up the scratch file even if
    // either step fails. The trap is inside a single host command so the
    // cleanup runs on the host even if our SSH connection drops.
    const script = `
set -u
BENCH_FILE=${SCRATCH_PATH}
# /DATA is root-owned; run everything under sudo -n (NOPASSWD on PCS hosts).
# Cleanup must also be sudo because the file we created is root-owned.
trap 'sudo -n rm -f "$BENCH_FILE"' EXIT
echo "===WRITE==="
sudo -n dd if=/dev/zero of="$BENCH_FILE" bs=1M count=${SIZE_MB} oflag=direct conv=fdatasync 2>&1
echo "===READ==="
# Use iflag=direct to bypass page cache; otherwise the read would just hit
# RAM and report fictional speeds.
sudo -n dd if="$BENCH_FILE" of=/dev/null bs=1M iflag=direct 2>&1
echo "===END==="
`;

    try {
        const result = await executeHostCommand(script, { timeout: 90000 });
        const out = result.stdout || "";
        const writeBlock = out.split("===WRITE===")[1]?.split("===READ===")[0] || "";
        const readBlock  = out.split("===READ===")[1]?.split("===END===")[0]   || "";

        const write = parseDdOutput(writeBlock);
        const read  = parseDdOutput(readBlock);

        const payload: DiskTestResult = {
            writeBps: write.bps,
            readBps:  read.bps,
            writeSeconds: write.seconds,
            readSeconds:  read.seconds,
            sizeBytes: SIZE_BYTES,
            target: SCRATCH_PATH,
            ranAt: new Date().toISOString(),
        };
        return res.status(200).json(payload);
    } catch (error) {
        return res.status(500).json({
            error: "Disk benchmark failed",
            details: error instanceof Error ? error.message : String(error),
        });
    }
}

export default authMiddleware(handler);
