import { execOnTarget, MigrationKeyPair, shq } from '../MigrationSSH';

const SCRIPT_PATH = '/DATA/AppData/casaos/apps/yundera/scripts/self-check/ensure-casaos-apps-up-to-date.sh';
const LOG_FILE = '/DATA/AppData/casaos/apps/yundera/log/yundera.log';

export interface FailedApp {
    name: string;
    reason: string;
}

export interface StartUserAppsResult {
    /**
     * Apps whose `docker compose up -d` failed on the target. The script
     * itself still exited 0 under FORCE_START=1 — these are recoverable
     * per-app failures (typically a deleted/renamed upstream image), not a
     * migration-level failure. The user re-installs the listed apps from the
     * AppStore after the migration completes.
     */
    failedApps: FailedApp[];
}

/**
 * Bring up the user's CasaOS apps on the migration target.
 *
 * The script `ensure-casaos-apps-up-to-date.sh` already knows how to render
 * the per-app env (DOMAIN, PUBLIC_IPV4/V6, DEFAULT_PWD, EMAIL, …) by reading
 * the target's `/DATA/AppData/casaos/apps/yundera/.env` and then runs
 * `docker compose up -d` per app. By the time we run here, `target_self_check`
 * has already re-executed the target's self-check chain — including
 * `ensure-public-ip.sh` and the other env-regenerating ensure-scripts — so
 * the .env on disk reflects the TARGET's IP/domain, not the rsynced source
 * values. The compose-up calls therefore inject the right env for the new
 * host.
 *
 * The default behaviour of that script is "skip apps that aren't currently
 * running" — correct on a healthy box (don't resurrect apps the user
 * intentionally stopped from the CasaOS UI), wrong post-migration where no
 * user apps are running yet because they were just rsynced. We pass
 * FORCE_START=1 to bypass that gate exactly once, during the migration
 * pipeline. After this step succeeds, ensure-casaos-apps-up-to-date.sh
 * resumes its normal gated behaviour on subsequent self-checks.
 *
 * Failure model: per-app failures (missing/renamed upstream images, broken
 * compose files) are NOT migration-fatal. The script emits one
 * `FAILED_APP: <name>: <reason>` line per failed app and exits 0 under
 * FORCE_START=1. We parse those markers and return them so the caller can
 * surface the list to the user via the migration step's message. Only an
 * actual script-level failure (SSH dropped, timeout, script crashed before
 * completing) throws here and rolls the migration back — losing 1/22 apps
 * to a deleted ghcr.io tag must not undo a complete data migration.
 *
 * Idempotent. Runs `docker compose up -d` per app; already-up containers
 * are no-ops. Skips `yundera` (the system stack — managed separately by
 * ensure-user-compose-* via `target_self_check`).
 */
export async function startUserAppsOnTarget(
    keypair: MigrationKeyPair,
    target: string
): Promise<StartUserAppsResult> {
    let stdout: string;
    try {
        const result = await execOnTarget(
            keypair,
            target,
            `FORCE_START=1 bash ${shq(SCRIPT_PATH)}`,
            { sudo: true, timeout: 15 * 60 * 1000 },
        );
        stdout = result.stdout || '';
    } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        let logTail = '';
        try {
            const tail = await execOnTarget(keypair, target, `tail -n 200 ${shq(LOG_FILE)}`, { sudo: true });
            logTail = tail.stdout || '';
        } catch {
            // best-effort
        }
        throw new Error(
            `start_user_apps failed: ${errorMsg}` +
            (logTail ? `\n--- Log tail (target) ---\n${logTail}` : '')
        );
    }

    return { failedApps: parseFailedApps(stdout) };
}

/**
 * Extract `FAILED_APP: <name>: <reason>` markers from the script's stdout.
 * Strict line-anchored match so docker compose's own error lines (which may
 * contain "failed" or "error" in the middle of a line) don't false-positive.
 * Reasons are already capped to ~200 chars by the shell side.
 */
function parseFailedApps(stdout: string): FailedApp[] {
    const out: FailedApp[] = [];
    for (const line of stdout.split('\n')) {
        const m = /^FAILED_APP:\s+(\S+):\s+(.+)$/.exec(line);
        if (m) out.push({ name: m[1], reason: m[2].trim() });
    }
    return out;
}
