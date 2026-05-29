import { NextApiRequest, NextApiResponse } from "next";
import { getNetworkBench } from "@/backend/server/Bench/BenchCache";

/**
 * Public network-bench endpoint.
 *
 * Same single-flight / cooldown-gated lazy-trigger contract as
 * /api/bench/disk — see that file for the full description. Cached result,
 * public path re-triggers at most once per cooldown window; immediate
 * cooldown-free refresh via the auth-gated
 * /api/admin/resources/network-test endpoint.
 */
export default function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== "GET") {
        res.setHeader("Allow", "GET");
        return res.status(405).json({ error: "Method not allowed" });
    }

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json(getNetworkBench());
}
