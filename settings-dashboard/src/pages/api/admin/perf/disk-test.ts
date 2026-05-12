import { NextApiRequest, NextApiResponse } from "next";
import { authMiddleware } from "@/backend/auth/middleware";
// import { executeHostCommand } from "@/backend/cmd/HostExecutor";

/**
 * STUB — disk bandwidth benchmark.
 *
 * Intended implementation: write and then read a scratch file inside
 * /DATA (the user data partition) with O_DIRECT to bypass the page cache,
 * then delete it. `dd` is universally available on the host; `fio` would
 * give cleaner numbers but requires installing it.
 *
 *   const PATH = "/DATA/.perf-bench.tmp";
 *   const SIZE_MB = 256;
 *
 *   // Sequential write
 *   const write = await executeHostCommand(
 *       `dd if=/dev/zero of=${PATH} bs=1M count=${SIZE_MB} oflag=direct conv=fdatasync 2>&1`
 *   );
 *   // Drop caches if you want a true cold read (requires sudo): echo 3 > /proc/sys/vm/drop_caches
 *   const read = await executeHostCommand(
 *       `dd if=${PATH} of=/dev/null bs=1M iflag=direct 2>&1`
 *   );
 *   await executeHostCommand(`rm -f ${PATH}`);
 *   // dd writes throughput to stderr in the form "... <N> bytes ... <X> MB/s"
 *
 * Be deliberate about file location, size, and cleanup. A failed bench
 * must still remove the scratch file.
 */

export interface DiskTestResult {
    writeBps: number;
    readBps: number;
    sizeBytes: number;
    target: string;
    ranAt: string;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== "POST") {
        res.setHeader("Allow", "POST");
        return res.status(405).json({ error: "Method not allowed" });
    }

    const stub: DiskTestResult = {
        writeBps: 0,
        readBps: 0,
        sizeBytes: 0,
        target: "stub://not-implemented",
        ranAt: new Date().toISOString(),
    };
    return res.status(501).json({ status: "not-implemented", stub });
}

export default authMiddleware(handler);
