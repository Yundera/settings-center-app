import {NextApiRequest, NextApiResponse} from 'next'
import {authMiddleware} from "@/backend/auth/middleware";
import {executeHostCommand} from "@/backend/cmd/HostExecutor";

/**
 * Reboots the host via SSH. The reboot is delayed and detached so the SSH
 * call can return cleanly before the host actually goes down.
 */
async function handler(
    req: NextApiRequest,
    res: NextApiResponse
) {
    if (req.method !== 'POST') {
        return res.status(405).json({error: 'Method not allowed'});
    }

    try {
        await executeHostCommand(
            `nohup sh -c 'sleep 2; sudo -n /sbin/reboot' > /dev/null 2>&1 < /dev/null &`
        );
        res.status(200).json({status: 'rebooting'});
    } catch (error) {
        res.status(500).json({
            error: 'Failed to reboot host',
            details: error instanceof Error ? error.message : String(error),
        });
    }
}

export default authMiddleware(handler);
