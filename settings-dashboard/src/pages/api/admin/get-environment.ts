import {NextApiRequest, NextApiResponse} from 'next'
import {adminMiddleware} from "@/backend/auth/middleware";
import {getConfig} from "@/configuration/getConfigBackend";

async function handler(
    req: NextApiRequest,
    res: NextApiResponse
) {
    if (req.method !== 'GET') {
        return res.status(405).json({error: 'Method not allowed'})
    }

    try {
        // Read environment variables from process.env. Only keys the compose file
        // hands the container (an enumerated list — no whole-file .env inject), so
        // nothing from .pcs.secret.env can appear here.
        const envConfig = {
            DOMAIN: getConfig("DOMAIN") || '',
            PUBLIC_IP: getConfig("PUBLIC_IP") || '',
            DEFAULT_SERVICE_HOST: getConfig("DEFAULT_SERVICE_HOST") || '',
            DEFAULT_SERVICE_PORT: getConfig("DEFAULT_SERVICE_PORT") || '',
        };

        res.status(200).json({
            status: 'success',
            data: envConfig
        });

    } catch (error) {
        res.status(500).json({
            error: 'Failed to load environment configuration',
            details: error instanceof Error ? error.message : String(error)
        });
    }
}

export default adminMiddleware(handler);