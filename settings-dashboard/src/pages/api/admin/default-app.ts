import {NextApiRequest, NextApiResponse} from 'next'
import {authMiddleware} from "@/backend/auth/middleware";
import {executeHostCommand} from "@/backend/cmd/HostExecutor";
import {getConfig} from "@/configuration/getConfigBackend";
import path from 'path';

interface DefaultAppRequest {
    host: string;
    port: string;
}

const HOST_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;
const PORT_RE = /^\d{1,5}$/;

async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({error: 'Method not allowed'});
    }

    const {host, port}: DefaultAppRequest = req.body || {};

    if (!host || !HOST_RE.test(host)) {
        return res.status(400).json({error: 'Invalid host'});
    }
    if (!port || !PORT_RE.test(port) || parseInt(port) < 1 || parseInt(port) > 65535) {
        return res.status(400).json({error: 'Invalid port'});
    }

    try {
        const composeFolder = getConfig("COMPOSE_FOLDER_PATH") || "/DATA/AppData/casaos/apps/yundera/";
        const envFilePath = path.join(composeFolder, '.pcs.env');
        // Per-key atomic edits via env-file-manager.sh. The previous full-file
        // round-trip silently truncated .pcs.env on read failure (file mode
        // 0600 owned by pcs after env-file-manager's mv-from-mktemp side-effect),
        // dropping every other key (YUNDERA_API, PUBLIC_IP*, etc.).
        const envMgr = path.join(composeFolder, 'scripts/tools/env-file-manager.sh');

        // host/port are already constrained to the regexes above, so no shell
        // metacharacters can reach the single-quoted argument.
        await executeHostCommand(`sudo -n "${envMgr}" set DEFAULT_SERVICE_HOST '${host}' "${envFilePath}"`);
        await executeHostCommand(`sudo -n "${envMgr}" set DEFAULT_SERVICE_PORT '${port}' "${envFilePath}"`);

        res.status(200).json({status: 'success', host, port});
    } catch (error) {
        res.status(500).json({
            error: 'Failed to update default app',
            details: error instanceof Error ? error.message : String(error),
        });
    }
}

export default authMiddleware(handler);
