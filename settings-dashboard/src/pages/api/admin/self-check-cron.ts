import {NextApiRequest, NextApiResponse} from 'next'
import {authMiddleware} from "@/backend/auth/middleware";
import {executeHostCommand} from "@/backend/cmd/HostExecutor";

const PCS_ENV = "/DATA/AppData/casaos/apps/yundera/.pcs.env";
const ENV_MGR = "/DATA/AppData/casaos/apps/yundera/scripts/tools/env-file-manager.sh";
const ENSURE_SCRIPT = "/DATA/AppData/casaos/apps/yundera/scripts/self-check/ensure-nightly-self-check.sh";
const VAR_NAME = "SELF_CHECK_CRON";
const DEFAULT_SCHEDULE = "0 3 * * *";

// Allowed values: a cron expression (5 fields) or one of these sentinels.
// Anything else is rejected before we shell out.
const SENTINELS = new Set(["disabled", "off"]);
const MAX_LEN = 200;

function isValidValue(v: string): boolean {
    if (SENTINELS.has(v)) return true;
    if (v.length === 0 || v.length > MAX_LEN) return false;
    // Whitelist cron field characters; this also blocks shell metacharacters.
    if (!/^[0-9*,\-\/\s]+$/.test(v)) return false;
    // Cron expression must have exactly 5 whitespace-separated fields.
    return v.trim().split(/\s+/).length === 5;
}

async function handler(
    req: NextApiRequest,
    res: NextApiResponse
) {
    try {
        if (req.method === 'GET') {
            const result = await executeHostCommand(`${ENV_MGR} get ${VAR_NAME} ${PCS_ENV}`);
            const raw = (result.stdout || '').trim();
            const effective = raw === '' ? DEFAULT_SCHEDULE : raw;
            return res.status(200).json({
                value: raw,            // what's actually in .pcs.env (may be empty)
                effective,             // what the cron will use
                default: DEFAULT_SCHEDULE,
            });
        }

        if (req.method === 'POST') {
            const value = String(req.body?.value ?? '').trim();
            if (!isValidValue(value)) {
                return res.status(400).json({
                    error: 'Invalid SELF_CHECK_CRON value',
                    hint: 'Expected a 5-field cron expression, "disabled", or "off".',
                });
            }

            // Quote the value for the shell since cron expressions contain spaces.
            // env-file-manager.sh writes to .pcs.env (owned by pcs:pcs), so
            // sudo to elevate from the admin SSH session.
            await executeHostCommand(`sudo -n ${ENV_MGR} set ${VAR_NAME} '${value}' ${PCS_ENV}`);

            // Apply immediately by re-running the ensure script. The script
            // installs root's crontab, so it must run as root.
            await executeHostCommand(`sudo -n bash ${ENSURE_SCRIPT}`);

            return res.status(200).json({status: 'ok', value});
        }

        return res.status(405).json({error: 'Method not allowed'});
    } catch (error) {
        return res.status(500).json({
            error: 'Self-check cron operation failed',
            details: error instanceof Error ? error.message : String(error),
        });
    }
}

export default authMiddleware(handler);
