import { NextApiRequest, NextApiResponse } from 'next';
import { authMiddleware } from '@/backend/auth/middleware';
import { getActionState } from '@/backend/server/Apps/Apps';

async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }
    const app = typeof req.query.app === 'string' ? req.query.app : '';
    if (!app) {
        return res.status(400).json({ error: 'Missing app query parameter' });
    }
    const state = getActionState(app);
    if (!state) {
        return res.status(200).json(null);
    }
    res.status(200).json(state);
}

export default authMiddleware(handler);
