import { NextApiRequest, NextApiResponse } from 'next';
import { authMiddleware } from '@/backend/auth/middleware';
import { startAction } from '@/backend/server/Apps/Apps';
import { AppActionRequest } from '@/backend/server/Apps/AppsTypes';

async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }
    try {
        const body = req.body as AppActionRequest;
        if (!body?.app || !body?.action) {
            return res.status(400).json({ error: 'Missing app or action' });
        }
        const state = startAction(body);
        res.status(202).json(state);
    } catch (error) {
        res.status(400).json({
            error: 'Failed to start action',
            details: error instanceof Error ? error.message : String(error),
        });
    }
}

export default authMiddleware(handler);
