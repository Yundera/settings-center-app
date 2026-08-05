import { NextApiRequest, NextApiResponse } from "next";
import { adminMiddleware } from "@/backend/auth/middleware";
import { runDiskBench, type DiskTestResult } from "@/backend/server/Bench/runners";

export type { DiskTestResult };

async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== "POST") {
        res.setHeader("Allow", "POST");
        return res.status(405).json({ error: "Method not allowed" });
    }

    try {
        const payload = await runDiskBench();
        return res.status(200).json(payload);
    } catch (error) {
        return res.status(500).json({
            error: "Disk benchmark failed",
            details: error instanceof Error ? error.message : String(error),
        });
    }
}

export default adminMiddleware(handler);
