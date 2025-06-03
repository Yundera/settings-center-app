import {NextApiRequest, NextApiResponse} from 'next'
import {authMiddleware} from "@/backend/auth/middleware";
import {checkForUpdates, getLastUpdateStatus} from "@/backend/server/DockerUpdate";


async function handler(
    req: NextApiRequest,
    res: NextApiResponse
) {
    if (req.method !== 'GET') {
        return res.status(405).json({error: 'Method not allowed'})
    }

    try {
        // Check each image for updates
        const updates = getLastUpdateStatus();

        res.status(200).json(updates);

    } catch (error) {
        res.status(500).json({
            error: 'Failed to check for updates',
            details: error instanceof Error ? error.message : String(error)
        });
    }
}

export default authMiddleware(handler);