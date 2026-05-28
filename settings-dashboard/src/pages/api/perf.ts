import { NextApiRequest, NextApiResponse } from "next";
import { getPublicMetricsResponse } from "@/backend/server/Metrics/Metrics";

/**
 * Public performance snapshot endpoint.
 *
 * Returns the sanitised CPU / RAM / disk-IO / disk-occupation / net-bytes
 * snapshot maintained in RAM by the Metrics module. The cache is refreshed by
 * a background SSH loop (5 min idle / 5 s while the dashboard is active) —
 * this handler never opens SSH or shells out, so it is safe to leave
 * unauthenticated, same pattern as /api/health.
 *
 * Intended consumer: the orchestrator's `pcs perf` CLI. The endpoint is GET-
 * only and never triggers a refresh on call; the background loop is the only
 * thing that writes to the cache.
 */
export default function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== "GET") {
        res.setHeader("Allow", "GET");
        return res.status(405).json({ error: "Method not allowed" });
    }

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json(getPublicMetricsResponse());
}
