import { NextApiRequest, NextApiResponse } from 'next';
import { authMiddleware } from '@/backend/auth/middleware';
import { disableAccount } from '@/backend/server/Migration/AccountManagement';

async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        await disableAccount();
        return res.status(200).json({ status: 'disabled' });
    } catch (err) {
        return res.status(500).json({
            error: 'Failed to disable migration account',
            details: err instanceof Error ? err.message : String(err),
        });
    }
}

export default authMiddleware(handler);
