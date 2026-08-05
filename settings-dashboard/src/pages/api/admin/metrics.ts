import { NextApiRequest, NextApiResponse } from "next";
import { adminMiddleware } from "@/backend/auth/middleware";
import { getMetricsResponse, notifyMetricsRead } from "@/backend/server/Metrics/Metrics";

/**
 * Returns the cached metrics response (latest snapshot + history buffer) from
 * RAM. The cache is owned by the Metrics module and refreshed in the
 * background — this handler never opens SSH or shells out, so it is cheap to
 * poll.
 *
 * Each read also marks the dashboard "active", which makes the background
 * sampling loop switch from its 5-minute idle cadence to a 5-second cadence
 * for as long as the panel keeps polling.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== "GET") {
        res.setHeader("Allow", "GET");
        return res.status(405).json({ error: "Method not allowed" });
    }
    notifyMetricsRead();
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json(getMetricsResponse());
}

export default adminMiddleware(handler);
