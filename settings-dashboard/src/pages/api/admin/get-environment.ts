import {NextApiRequest, NextApiResponse} from 'next'
import {authMiddleware} from "@/backend/auth/middleware";
import {getConfig} from "@/configuration/getConfigBackend";

async function handler(
    req: NextApiRequest,
    res: NextApiResponse
) {
    if (req.method !== 'GET') {
        return res.status(405).json({error: 'Method not allowed'})
    }

    try {
        // Read environment variables from process.env
        const envConfig = {
            DOMAIN: getConfig("DOMAIN") || '',
            PROVIDER_STR: getConfig("PROVIDER_STR") || '',
            UID: getConfig("UID") || '',
            DEFAULT_PWD: getConfig("DEFAULT_PWD") || '',
            PUBLIC_IP: getConfig("PUBLIC_IP") || '',
            DEFAULT_USER: getConfig("DEFAULT_USER") || '',
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

export default authMiddleware(handler);