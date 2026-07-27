import {NextApiRequest, NextApiResponse} from 'next'
import {authMiddleware} from "@/backend/auth/middleware";
import {executeHostCommand} from "@/backend/cmd/HostExecutor";
import {latestSelfCheckRun, ScriptResult, SelfCheckRun} from "@/backend/server/Health/SelfCheckLog";

const LOG_FILE = "/DATA/AppData/casaos/apps/yundera/log/yundera.log";

// A full run is ~200 log lines when everything is quiet, but a failing script
// re-runs its command verbosely, so give the tail plenty of headroom. Reading
// this over SSH costs a few hundred KB at worst and the UI polls it, not the
// raw-log endpoint, so overall traffic goes down rather than up.
const DEFAULT_LINES = 4000;
const MAX_LINES = 20000;

/**
 * Structured summary of the most recent self-check run.
 *
 * Only the latest run is reported. History beyond it is not reachable from
 * this file anyway: logrotate on the PCS is daily/rotate 7 with dateext, so
 * yundera.log typically holds one or two runs and older ones live in
 * compressed siblings.
 *
 * Captured output is returned only for scripts that failed or are still
 * running — a successful script's output is noise by the "quiet success,
 * verbose failure" convention, and dropping it keeps the payload small on a
 * 5s poll.
 */
function slimScript(script: ScriptResult): ScriptResult {
    if (script.status === "success") {
        return {...script, output: [], outputTruncated: false};
    }
    return script;
}

function slimRun(run: SelfCheckRun): SelfCheckRun {
    return {...run, scripts: run.scripts.map(slimScript)};
}

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
        const run = latestSelfCheckRun(result.stdout || "");
        res.status(200).json({
            run: run ? slimRun(run) : null,
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
