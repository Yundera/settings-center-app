import { NextApiRequest, NextApiResponse } from 'next';
import { adminMiddleware } from "@/backend/auth/middleware";
import { fetchSupportKey } from "@/backend/server/Support/SupportKey";

async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }
    try {
        const key = await fetchSupportKey();
        res.setHeader('Cache-Control', 'no-store');
        res.status(200).json(key);
    } catch (error) {
        res.status(502).json({
            error: 'Failed to fetch support key from orchestrator',
            details: error instanceof Error ? error.message : String(error),
        });
    }
}

export default adminMiddleware(handler);
