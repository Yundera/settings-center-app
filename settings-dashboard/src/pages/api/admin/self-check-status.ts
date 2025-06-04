import {NextApiRequest, NextApiResponse} from 'next'
import {authMiddleware} from "@/backend/auth/middleware";
import {getSelfCheckStatus} from "@/backend/server/SelfCheck/SelfCheck";

async function handler(
    req: NextApiRequest,
    res: NextApiResponse
) {
    if (req.method !== 'GET') {
        return res.status(405).json({error: 'Method not allowed'})
    }

    try {

        // Get current self-check status from shared context
        const status = await getSelfCheckStatus();

        res.status(200).json(status);

    } catch (error) {
        res.status(500).json({
            error: 'Failed to get self-check status',
            details: error instanceof Error ? error.message : String(error)
        });
    }
}

export default authMiddleware(handler);