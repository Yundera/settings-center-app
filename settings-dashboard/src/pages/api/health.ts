import { NextApiRequest, NextApiResponse } from "next";
import { getHealthSnapshot } from "@/backend/server/Health/Health";

/**
 * Public health endpoint.
 *
 * Returns the cached version + last self-check outcome from RAM only — no
 * SSH, no file reads, no shell. The cache is refreshed in the background by
 * the Health module (see backend/server/Health/Health.ts). This is safe to
 * leave unauthenticated because it never recomputes anything on demand.
 *
 * Intended consumer: Yundera's daily health probe per PCS.
 */
export default function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== "GET") {
        res.setHeader("Allow", "GET");
        return res.status(405).json({ error: "Method not allowed" });
    }

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json(getHealthSnapshot());
}
