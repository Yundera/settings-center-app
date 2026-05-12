import { NextApiRequest, NextApiResponse } from "next";
import { authMiddleware } from "@/backend/auth/middleware";
// import { executeHostCommand } from "@/backend/cmd/HostExecutor";

/**
 * STUB — network throughput benchmark.
 *
 * Intended implementation (once tuned on a real PCS):
 *
 *   const SIZE = 25 * 1024 * 1024; // 25 MiB
 *   const down = await executeHostCommand(
 *       `curl -s -o /dev/null -w '%{time_total} %{speed_download}' ` +
 *       `https://speed.cloudflare.com/__down?bytes=${SIZE}`
 *   );
 *   const up = await executeHostCommand(
 *       `head -c ${SIZE} /dev/urandom | curl -s -o /dev/null -w '%{time_total} %{speed_upload}' ` +
 *       `-X POST --data-binary @- https://speed.cloudflare.com/__up`
 *   );
 *   // parse "<seconds> <bytes_per_sec>" from each
 *
 * Pin the exact endpoint and payload size after measuring on real hardware —
 * Cloudflare's speed test endpoints occasionally move.
 */

export interface NetworkTestResult {
    downloadBps: number;
    uploadBps: number;
    downloadSeconds: number;
    uploadSeconds: number;
    target: string;
    ranAt: string;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== "POST") {
        res.setHeader("Allow", "POST");
        return res.status(405).json({ error: "Method not allowed" });
    }

    const stub: NetworkTestResult = {
        downloadBps: 0,
        uploadBps: 0,
        downloadSeconds: 0,
        uploadSeconds: 0,
        target: "stub://not-implemented",
        ranAt: new Date().toISOString(),
    };
    return res.status(501).json({ status: "not-implemented", stub });
}

export default authMiddleware(handler);
