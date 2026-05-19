import { NextApiRequest, NextApiResponse } from 'next';
import { authMiddleware } from '@/backend/auth/middleware';
import { getAppsSnapshot } from '@/backend/server/Apps/Apps';

async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }
    try {
        const snapshot = await getAppsSnapshot();
        res.status(200).json(snapshot);
    } catch (error) {
        res.status(500).json({
            error: 'Failed to list apps',
            details: error instanceof Error ? error.message : String(error),
        });
    }
}

export default authMiddleware(handler);
