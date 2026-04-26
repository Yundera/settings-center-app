import { NextApiRequest, NextApiResponse } from 'next';
import { authMiddleware } from '@/backend/auth/middleware';
import { getMigrationStatus } from '@/backend/server/Migration/Migration';

async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const status = await getMigrationStatus();
        return res.status(200).json(status);
    } catch (err) {
        return res.status(500).json({
            error: 'Failed to read status',
            details: err instanceof Error ? err.message : String(err),
        });
    }
}

export default authMiddleware(handler);
