import { NextApiRequest, NextApiResponse } from 'next';
import { authMiddleware } from '@/backend/auth/middleware';
import { enableAccount } from '@/backend/server/Migration/AccountManagement';

async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const result = await enableAccount();
        return res.status(200).json(result);
    } catch (err) {
        return res.status(500).json({
            error: 'Failed to enable migration account',
            details: err instanceof Error ? err.message : String(err),
        });
    }
}

export default authMiddleware(handler);
