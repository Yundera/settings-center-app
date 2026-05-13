import { NextApiRequest, NextApiResponse } from "next";
import { authMiddleware } from "@/backend/auth/middleware";
import { executeHostCommand } from "@/backend/cmd/HostExecutor";

// 25 MiB. Big enough that link speed dominates over connection overhead on
// any sensible PCS uplink, small enough that the test completes in seconds.
const SIZE_BYTES = 25 * 1024 * 1024;
const TARGET = "https://speed.cloudflare.com";

export interface NetworkTestResult {
    downloadBps: number;
    uploadBps: number;
    downloadSeconds: number;
    uploadSeconds: number;
    sizeBytes: number;
    target: string;
    ranAt: string;
}

// `curl -w` writes "<seconds> <bytes/sec>" to stdout. Parse both as floats.
function parseCurlOutput(stdout: string): { seconds: number; bps: number } {
    const m = stdout.trim().match(/^([\d.]+)\s+([\d.]+)$/);
    if (!m) throw new Error(`Unexpected curl output: ${stdout.slice(0, 120)}`);
    return { seconds: parseFloat(m[1]), bps: parseFloat(m[2]) };
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== "POST") {
        res.setHeader("Allow", "POST");
        return res.status(405).json({ error: "Method not allowed" });
    }

    try {
        const downCmd =
            `curl -fsS -o /dev/null -w '%{time_total} %{speed_download}' ` +
            `--max-time 60 '${TARGET}/__down?bytes=${SIZE_BYTES}'`;
        const upCmd =
            `head -c ${SIZE_BYTES} /dev/urandom | ` +
            `curl -fsS -o /dev/null -w '%{time_total} %{speed_upload}' ` +
            `--max-time 60 -X POST --data-binary @- ` +
            `-H 'Content-Type: application/octet-stream' '${TARGET}/__up'`;

        // Sequential rather than parallel — running upload and download at the
        // same time would have them compete for the same link and underreport
        // both. The whole test still fits in well under a minute.
        const downRes = await executeHostCommand(downCmd, { timeout: 75000 });
        const down = parseCurlOutput(downRes.stdout);
        const upRes = await executeHostCommand(upCmd, { timeout: 75000 });
        const up = parseCurlOutput(upRes.stdout);

        const result: NetworkTestResult = {
            downloadBps: down.bps,
            uploadBps: up.bps,
            downloadSeconds: down.seconds,
            uploadSeconds: up.seconds,
            sizeBytes: SIZE_BYTES,
            target: TARGET,
            ranAt: new Date().toISOString(),
        };
        return res.status(200).json(result);
    } catch (error) {
        return res.status(500).json({
            error: "Speed test failed",
            details: error instanceof Error ? error.message : String(error),
        });
    }
}

export default authMiddleware(handler);
