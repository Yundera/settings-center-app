import { NextApiRequest, NextApiResponse } from "next";
import { getHealthSnapshot } from "@/backend/server/Health/Health";

/**
 * Public health endpoint.
 *
 * Returns the cached version, last self-check outcome, and this container's
 * process-pressure sample from RAM only — no SSH, no file reads, no shell. The
 * cache is refreshed in the background by the Health module (see
 * backend/server/Health/Health.ts). This is safe to leave unauthenticated
 * because it never recomputes anything on demand, and because the payload
 * carries no secrets or user data — PID counters describe the container's own
 * plumbing, nothing about who is using it.
 *
 * Intended consumer: Yundera's daily health probe per PCS. `processPressure`
 * is aimed squarely at that probe: it is a leak indicator that climbs for days
 * before anything visibly breaks (see ProcessPressure.ts).
 */
export default function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== "GET") {
        res.setHeader("Allow", "GET");
        return res.status(405).json({ error: "Method not allowed" });
    }

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json(getHealthSnapshot());
}
