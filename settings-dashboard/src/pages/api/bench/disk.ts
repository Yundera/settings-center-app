import { NextApiRequest, NextApiResponse } from "next";
import { getDiskBench } from "@/backend/server/Bench/BenchCache";

/**
 * Public disk-bench endpoint.
 *
 * Returns the last cached result from the BenchCache single-flight wrapper.
 * If the cooldown since the last attempt has elapsed AND no run is in flight,
 * calling this endpoint triggers one bench in the background and returns
 * immediately with `status: "pending"`. Subsequent calls during the run share
 * the same in-flight promise, and the cooldown caps how often the public path
 * can start a run (win or fail), so the endpoint cannot be used to spam the
 * host with `dd` — see BenchCache.ts.
 *
 * For an immediate, cooldown-free refresh use the auth-gated
 * /api/admin/resources/disk-test endpoint. The cached value's lifecycle is the
 * admin container's process; a restart re-arms the lazy trigger on the next call.
 *
 * Response shape:
 *   { status: "pending" | "ok" | "error",
 *     result: DiskTestResult | null,
 *     ranAt: ISO timestamp | null,
 *     pendingSince: ISO timestamp | null,
 *     error: string | null }
 */
export default function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== "GET") {
        res.setHeader("Allow", "GET");
        return res.status(405).json({ error: "Method not allowed" });
    }

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json(getDiskBench());
}
