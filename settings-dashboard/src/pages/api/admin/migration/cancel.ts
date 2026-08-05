import { NextApiRequest, NextApiResponse } from 'next';
import { adminMiddleware } from '@/backend/auth/middleware';
import { requestCancel } from '@/backend/server/Migration/Migration';

async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        await requestCancel();
        return res.status(200).json({ status: 'cancel_requested' });
    } catch (err) {
        return res.status(500).json({
            error: 'Failed to request cancel',
            details: err instanceof Error ? err.message : String(err),
        });
    }
}

export default adminMiddleware(handler);
