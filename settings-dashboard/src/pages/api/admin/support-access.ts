import { NextApiRequest, NextApiResponse } from 'next';
import { adminMiddleware } from "@/backend/auth/middleware";
import {
    disableSupportAccess,
    enableSupportAccess,
    getSupportAccessStatus,
} from "@/backend/server/Support/SupportAccess";

async function handler(req: NextApiRequest, res: NextApiResponse) {
    try {
        if (req.method === 'GET') {
            const status = await getSupportAccessStatus();
            res.setHeader('Cache-Control', 'no-store');
            return res.status(200).json(status);
        }
        if (req.method === 'POST') {
            const { enable } = (req.body || {}) as { enable?: boolean };
            if (typeof enable !== 'boolean') {
                return res.status(400).json({ error: 'Body must include { enable: boolean }' });
            }
            if (enable) {
                const result = await enableSupportAccess();
                return res.status(200).json({ enabled: true, status: result.status, fingerprint: result.key.fingerprint });
            } else {
                const result = await disableSupportAccess();
                return res.status(200).json({ enabled: false, status: result.status, removed: result.removed, fingerprint: result.key.fingerprint });
            }
        }
        return res.status(405).json({ error: 'Method not allowed' });
    } catch (error) {
        res.status(500).json({
            error: 'Support access operation failed',
            details: error instanceof Error ? error.message : String(error),
        });
    }
}

export default adminMiddleware(handler);
