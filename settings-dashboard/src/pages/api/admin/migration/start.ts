import { NextApiRequest, NextApiResponse } from 'next';
import { adminMiddleware } from '@/backend/auth/middleware';
import { startMigration } from '@/backend/server/Migration/Migration';

async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { host, user, password, webhookUrl } = req.body ?? {};
    if (!host || !user || !password) {
        return res.status(400).json({ error: 'host, user, password required' });
    }

    try {
        const status = await startMigration({ host, user, password, webhookUrl });
        return res.status(200).json(status);
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const code = msg.includes('already in progress') ? 409 : 500;
        return res.status(code).json({
            error: 'Failed to start migration',
            details: msg,
        });
    }
}

export default adminMiddleware(handler);
