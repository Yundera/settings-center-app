import {NextApiRequest, NextApiResponse} from 'next'
import {authMiddleware} from "@/backend/auth/middleware";
import {executeHostCommand} from "@/backend/cmd/HostExecutor";

const LOG_FILE = "/DATA/AppData/casaos/apps/yundera/log/yundera.log";
const DEFAULT_LINES = 300;
const MAX_LINES = 5000;

async function handler(
    req: NextApiRequest,
    res: NextApiResponse
) {
    if (req.method !== 'GET') {
        return res.status(405).json({error: 'Method not allowed'});
    }

    const linesParam = parseInt(String(req.query.lines || ''), 10);
    const lines = Number.isFinite(linesParam) && linesParam > 0
        ? Math.min(linesParam, MAX_LINES)
        : DEFAULT_LINES;

    try {
        const result = await executeHostCommand(`tail -n ${lines} ${LOG_FILE}`);
        res.status(200).json({
            log: result.stdout || '',
            lines,
        });
    } catch (error) {
        res.status(500).json({
            error: 'Failed to read self-check log',
            details: error instanceof Error ? error.message : String(error),
        });
    }
}

export default authMiddleware(handler);
