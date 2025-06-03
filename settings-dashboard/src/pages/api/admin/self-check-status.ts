import {NextApiRequest, NextApiResponse} from 'next'
import {authMiddleware} from "@/backend/auth/middleware";
import {getSelfCheckStatusAsync} from "@/backend/server/SelfCheck";
import SharedContext from "@/backend/server/SharedContext";

async function handler(
    req: NextApiRequest,
    res: NextApiResponse
) {
    if (req.method !== 'GET') {
        return res.status(405).json({error: 'Method not allowed'})
    }

    try {
        // Ensure shared context is initialized for API requests
        SharedContext.getInstance();

        // Get current self-check status from shared context
        const status = await getSelfCheckStatusAsync();

        res.status(200).json(status);

    } catch (error) {
        res.status(500).json({
            error: 'Failed to get self-check status',
            details: error instanceof Error ? error.message : String(error)
        });
    }
}

export default authMiddleware(handler);