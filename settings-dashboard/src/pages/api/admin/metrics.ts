import { NextApiRequest, NextApiResponse } from "next";
import { authMiddleware } from "@/backend/auth/middleware";
import { getMetricsSnapshot } from "@/backend/server/Metrics/Metrics";

/**
 * Returns the cached metrics snapshot from RAM. The cache is owned by the
 * Metrics module and refreshed in the background — this handler never opens
 * SSH or shells out, so it is cheap to poll.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== "GET") {
        res.setHeader("Allow", "GET");
        return res.status(405).json({ error: "Method not allowed" });
    }
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json(getMetricsSnapshot());
}

export default authMiddleware(handler);
