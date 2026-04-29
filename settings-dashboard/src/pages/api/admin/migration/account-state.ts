import { NextApiRequest, NextApiResponse } from 'next';
import { authMiddleware } from '@/backend/auth/middleware';
import { getAccountState } from '@/backend/server/Migration/AccountManagement';

async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const state = await getAccountState();
        return res.status(200).json({ state });
    } catch (err) {
        return res.status(500).json({
            error: 'Failed to read migration account state',
            details: err instanceof Error ? err.message : String(err),
        });
    }
}

export default authMiddleware(handler);
