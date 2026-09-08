import { execOnTarget, MigrationKeyPair, shq } from '../MigrationSSH';
import { yndPath } from '@/configuration/yndRoot';

const LOG_FILE = yndPath('log/yundera.log');

/**
 * Stacks the target's own self-check owns. Bringing them up from here would
 * race `ensure-user-compose-stack-up.sh` / `ensure-maison-stack.sh` /
 * `ensure-kopia-stack.sh`, which `target_self_check` has already run — and
 * those three need env and secrets this loop does not render.
 */
const SYSTEM_STACKS = ['yundera', 'maison', 'kopia', 'casaos'];

export interface FailedApp {
    name: string;
    reason: string;
}

export interface StartUserAppsResult {
    /**
     * Apps whose `docker compose up -d` failed on the target. These are
     * recoverable per-app failures (typically a deleted/renamed upstream
     * image), not a migration-level failure. The user re-installs the listed
     * apps from the store after the migration completes.
     */
    failedApps: FailedApp[];
}

/**
 * Bring the user's apps up on the migration target.
 *
 * WHAT THIS USED TO DO, AND WHY IT NO LONGER CAN. This step used to run
 * `ensure-casaos-apps-up-to-date.sh` with `FORCE_START=1`. That script was
 * deleted with CasaOS (2026-08-02), so the step has been failing the whole
 * migration ever since — it is the "re-point `start_user_apps`" item in
 * template-root's `doc/maison-migration.md` phase 2. The loop below is what
 * that script did for our purposes, inlined: one `docker compose up -d` per
 * app folder.
 *
 * WHY AN INLINE LOOP RATHER THAN A HOST SCRIPT. There is no longer a script
 * on the box whose job is "start the user's apps": Maison starts an app when
 * a person asks it to, and Docker's restart policies handle a reboot. A
 * migration target is the one situation where neither applies — the app files
 * exist, the containers do not — so the loop lives here, at the only caller.
 *
 * WHERE THE APPS ARE. `/DATA/AppData/<app>/`, Maison's flat layout: compose,
 * `.env` and the app's data in one folder. Compose auto-loads
 * `docker-compose.override.yml` and `.env` from the project directory, so a
 * bare `up -d` there is exactly what Maison itself runs. Apps that predate
 * Maison have the same folder — the app mirror wrote it, and its render check
 * asserted it resolves identically to the CasaOS-side original.
 *
 * ENV IS ALREADY CORRECT BY THE TIME WE RUN. `target_self_check` has
 * re-executed the target's ensure-chain, including `ensure-public-ip.sh`, so
 * the values these composes interpolate describe the TARGET's IP and domain,
 * not the rsynced source's.
 *
 * IT STARTS EVERYTHING, deliberately. On a healthy box "don't resurrect what
 * the user stopped" is the right rule; on a migration target nothing is
 * running because nothing was ever created, so the rule has nothing to read.
 * This is the same reason the old script was called with `FORCE_START=1`.
 *
 * Failure model, unchanged: per-app failures (missing upstream image, broken
 * compose) are NOT migration-fatal — they are reported as `FAILED_APP` and
 * surfaced to the user, because losing 1/22 apps to a deleted ghcr.io tag must
 * not undo a complete data migration. Only a step-level failure (SSH dropped,
 * timeout) throws and rolls the migration back.
 *
 * Idempotent: `up -d` on an already-running stack is a no-op.
 */
export async function startUserAppsOnTarget(
    keypair: MigrationKeyPair,
    target: string
): Promise<StartUserAppsResult> {
    // Built from constants only — no caller input reaches this string.
    // `/DATA/AppData/*/` does not match dot-directories, which is how Maison's
    // own hidden state and `<app>.<date>.archive` folders stay out of it.
    //
    // QUOTING: this goes to `bash -c` through shq(), i.e. single-quoted, so the
    // remote login shell hands it over verbatim and every `$app` / `$(…)` below
    // is expanded by that bash and not before it. Double quotes here would let
    // the login shell expand them first, against an empty environment.
    const script =
        `for dir in /DATA/AppData/*/; do ` +
        `app=$(basename "$dir"); ` +
        `case " ${SYSTEM_STACKS.join(' ')} " in *" $app "*) continue;; esac; ` +
        `[ -f "$dir/docker-compose.yml" ] || continue; ` +
        `if ! out=$(cd "$dir" && docker compose up -d 2>&1); then ` +
        `echo "FAILED_APP: $app: $(printf '%s' "$out" | tr '\\n' ' ' | cut -c1-200)"; ` +
        `fi; ` +
        `done; exit 0`;

    let stdout: string;
    try {
        const result = await execOnTarget(
            keypair,
            target,
            `bash -c ${shq(script)}`,
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
 * Extract `FAILED_APP: <name>: <reason>` markers from the loop's stdout.
 * Strict line-anchored match so docker compose's own error lines (which may
 * contain "failed" or "error" mid-line) don't false-positive.
 */
function parseFailedApps(stdout: string): FailedApp[] {
    const out: FailedApp[] = [];
    for (const line of stdout.split('\n')) {
        const m = /^FAILED_APP:\s+(\S+):\s+(.+)$/.exec(line);
        if (m) out.push({ name: m[1], reason: m[2].trim() });
    }
    return out;
}
