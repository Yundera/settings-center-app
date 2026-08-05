import {NextApiRequest, NextApiResponse} from 'next'
import {adminMiddleware} from "@/backend/auth/middleware";
import {executeHostCommand} from "@/backend/cmd/HostExecutor";

const SELF_CHECK_SCRIPT = "/DATA/AppData/casaos/apps/yundera/scripts/self-check.sh";

/**
 * Kicks off self-check.sh detached on the host. Returns immediately.
 * The script's own flock prevents overlap with the @reboot or nightly run —
 * if one is already in flight, the new invocation logs "Another self-check
 * instance is running, exiting" and exits 0.
 *
 * Progress is observable by tailing the log via /api/admin/self-check-log.
 */
async function handler(
    req: NextApiRequest,
    res: NextApiResponse
) {
    if (req.method !== 'POST') {
        return res.status(405).json({error: 'Method not allowed'});
    }

    try {
        // self-check.sh and the ensure-*.sh scripts it invokes assume root
        // (useradd, systemctl, /etc/sudoers.d, dpkg-reconfigure, ...). The
        // SSH session is the `admin` sudoer, so wrap the whole thing in
        // `sudo -n` (NOPASSWD via /etc/sudoers.d/90-admin-nopasswd).
        await executeHostCommand(
            `nohup sudo -n bash ${SELF_CHECK_SCRIPT} > /dev/null 2>&1 < /dev/null &`
        );
        res.status(200).json({status: 'started'});
    } catch (error) {
        res.status(500).json({
            error: 'Failed to start self-check',
            details: error instanceof Error ? error.message : String(error),
        });
    }
}

export default adminMiddleware(handler);
