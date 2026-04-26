import { NextApiRequest, NextApiResponse } from 'next';
import { authMiddleware } from '@/backend/auth/middleware';
import { runPreflight } from '@/backend/server/Migration/steps/preflight';

async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { host, user, password } = req.body ?? {};
    if (!host || !user || !password) {
        return res.status(400).json({ error: 'host, user, password required' });
    }

    try {
        const result = await runPreflight({ host, user, password });
        return res.status(200).json(result);
    } catch (err) {
        return res.status(500).json({
            error: 'Preflight failed',
            details: err instanceof Error ? err.message : String(err),
        });
    }
}

export default authMiddleware(handler);
