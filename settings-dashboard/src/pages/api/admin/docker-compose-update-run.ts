import {NextApiRequest, NextApiResponse} from 'next'
import {authMiddleware} from "@/backend/auth/middleware";
import {dockerUpdate} from "@/backend/server/DockerUpdate/DockerUpdate";

async function handler(
    req: NextApiRequest,
    res: NextApiResponse
) {
    if (req.method !== 'POST') {
        return res.status(405).json({error: 'Method not allowed'})
    }

    try {
        // Execute commands in sequence
        await dockerUpdate();

        res.status(200).json({
            status: 'success',
        })
    } catch (error) {
        res.status(500).json({
            error: 'Failed to update Docker Compose images',
            details: error.message
        })
    }
}

export default authMiddleware(handler);