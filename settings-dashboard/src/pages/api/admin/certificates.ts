import { NextApiRequest, NextApiResponse } from 'next';
import { authMiddleware } from '@/backend/auth/middleware';
import { getCertificatesSnapshot } from '@/backend/server/Certificates/Certificates';

async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }
    try {
        const snapshot = await getCertificatesSnapshot();
        res.status(200).json(snapshot);
    } catch (error) {
        res.status(500).json({
            error: 'Failed to check certificates',
            details: error instanceof Error ? error.message : String(error),
        });
    }
}

export default authMiddleware(handler);
