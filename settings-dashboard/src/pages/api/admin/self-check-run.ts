import {NextApiRequest, NextApiResponse} from 'next'
import {authMiddleware} from "@/backend/auth/middleware";
import {runSelfCheck} from "@/backend/server/SelfCheck";
import SharedContext from "@/backend/server/SharedContext";

async function handler(
    req: NextApiRequest,
    res: NextApiResponse
) {
    if (req.method !== 'POST') {
        return res.status(405).json({error: 'Method not allowed'})
    }

    try {
        // Ensure shared context is initialized for API requests
        SharedContext.getInstance();

        // Run the self-check scripts (this will automatically update the shared context)
        await runSelfCheck();

        res.status(200).json({
            status: 'success',
            message: 'Self-check completed successfully'
        });

    } catch (error) {
        res.status(500).json({
            error: 'Self-check failed',
            details: error instanceof Error ? error.message : String(error)
        });
    }
}

export default authMiddleware(handler);