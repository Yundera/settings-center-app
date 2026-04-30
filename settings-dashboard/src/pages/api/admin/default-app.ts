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

function upsertEnvVar(content: string, key: string, value: string): string {
    const lines = content.split('\n');
    const idx = lines.findIndex(l => l.startsWith(`${key}=`));
    const newLine = `${key}=${value}`;
    if (idx >= 0) {
        lines[idx] = newLine;
    } else if (lines.length === 1 && lines[0] === '') {
        lines[0] = newLine;
    } else {
        lines.push(newLine);
    }
    return lines.join('\n');
}

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

        // Read current .pcs.env content (may not exist yet).
        let envContent = '';
        try {
            const result = await executeHostCommand(`cat "${envFilePath}"`);
            envContent = result.stdout;
        } catch {
            envContent = '';
        }

        envContent = upsertEnvVar(envContent, 'DEFAULT_SERVICE_HOST', host);
        envContent = upsertEnvVar(envContent, 'DEFAULT_SERVICE_PORT', port);

        // .pcs.env is owned by pcs:pcs (set by ensure-template-sync.sh), so the
        // admin SSH session elevates via sudo -n NOPASSWD to write it. Mirrors
        // update-channel.ts — no dependency on env-file-manager.sh being
        // present on the host (ensure-template-sync.sh's rsync --delete can
        // remove it if the upstream template is older).
        await executeHostCommand(`sudo -n mkdir -p "${path.dirname(envFilePath)}"`);
        const escapedContent = envContent.replace(/"/g, '\\"');
        await executeHostCommand(
            `echo "${escapedContent}" | sudo -n tee "${envFilePath}" > /dev/null`
        );

        res.status(200).json({status: 'success', host, port});
    } catch (error) {
        res.status(500).json({
            error: 'Failed to update default app',
            details: error instanceof Error ? error.message : String(error),
        });
    }
}

export default authMiddleware(handler);
