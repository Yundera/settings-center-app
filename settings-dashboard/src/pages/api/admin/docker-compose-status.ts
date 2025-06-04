import {NextApiRequest, NextApiResponse} from 'next'
import {authMiddleware} from "@/backend/auth/middleware";
import {getLastUpdateStatus} from "@/backend/server/DockerUpdate/DockerUpdate";

async function handler(
    req: NextApiRequest,
    res: NextApiResponse
) {
    if (req.method !== 'GET') {
        return res.status(405).json({error: 'Method not allowed'})
    }

    try {

        // Get the last update status from shared context
        const updates = await getLastUpdateStatus();

        res.status(200).json(updates);

    } catch (error) {
        res.status(500).json({
            error: 'Failed to get update status',
            details: error instanceof Error ? error.message : String(error)
        });
    }
}

export default authMiddleware(handler);