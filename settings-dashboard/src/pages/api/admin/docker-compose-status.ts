import {NextApiRequest, NextApiResponse} from 'next'
import {authMiddleware} from "@/backend/auth/middleware";
import {getLastUpdateStatusAsync} from "@/backend/server/DockerUpdate";
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

        // Get the last update status from shared context
        const updates = await getLastUpdateStatusAsync();

        res.status(200).json(updates);

    } catch (error) {
        res.status(500).json({
            error: 'Failed to get update status',
            details: error instanceof Error ? error.message : String(error)
        });
    }
}

export default authMiddleware(handler);