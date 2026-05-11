import { executeHostCommand } from '@/backend/cmd/HostExecutor';

/**
 * Final source-side step: schedule the source PCS to bring down its own
 * yundera system stack (admin + mesh-router-* + auth-registrar + smtp +
 * authelia) so the target becomes the sole agent registered with
 * mesh-router-backend for this domain. Without this, both PCSes register
 * themselves and the cutover is a mushy race — see the design discussion
 * in doc/architecture/migration.md.
 *
 * Why detached: this step has to bring down `admin`, but `admin` is the
 * very process running this pipeline. Calling `docker compose down …`
 * synchronously would kill our own pid mid-step, the pipeline would
 * never reach `done`, and `webhook` (already-fired) would be the last
 * signal the orchestrator ever got. The step instead writes a small
 * shell script and detaches it via `setsid` + redirected std streams, so
 * the script outlives this Node process. The script sleeps long enough
 * for the pipeline to wrap up cleanly, then runs `docker compose down`.
 *
 * Step ordering: `cleanup` runs before us (needs admin alive to SSH the
 * target). `webhook` runs AFTER us — the hand-off signal is the final
 * step. Webhook fires HTTP-only and is fast (<2s typical); the detached
 * teardown script sleeps SWITCHOVER_DELAY_SEC (default 60s) before
 * `docker compose down`, which is plenty of slack for webhook +
 * phase=done writes to land before admin dies. The orchestrator's
 * webhook handler then drives `pcs-mig-* → pcs-<pcsId>` rename + source
 * soft-delete via the provider API; its Contabo-API stop typically
 * races ahead of the detached teardown, and both paths converge on
 * "source goes silent."
 *
 * Path B (manual) vs Path C (orchestrator-driven): both paths land here
 * the same way. The orchestrator's `promoteMigrationAndDeleteSource`
 * (Path C, on webhook) and the dashboard's "Complete migration" button
 * (Path B) both run AFTER this step has scheduled the silencing, so the
 * `waitForDomainReady` health check is a real test of "target serving
 * alone" rather than racing against source's still-active mesh-router.
 *
 * Recovery: if anything downstream goes wrong (orchestrator promote
 * fails, network blip), the source VPS is still alive — only its
 * containers are stopped. Operator can `docker compose -f
 * /DATA/AppData/casaos/apps/yundera/docker-compose.yml up -d` to revive.
 */

const YUNDERA_COMPOSE = '/DATA/AppData/casaos/apps/yundera/docker-compose.yml';
const SWITCHOVER_SCRIPT_PATH = '/tmp/migration-switchover.sh';
const SWITCHOVER_LOG_PATH = '/tmp/migration-switchover.log';

/**
 * Seconds to sleep before the detached script touches `docker compose
 * down`. Generous — only `cleanup` and the final state writes happen
 * after this step, both fast (<2s in practice). The user's pipeline
 * exits within a couple of seconds; the rest of the window is slack so
 * a slow Firestore round-trip on the orchestrator side (e.g. updating
 * `migrationAutoStatus` on webhook receipt) finishes before admin dies.
 */
const SWITCHOVER_DELAY_SEC = 60;

export async function scheduleSwitchover(): Promise<void> {
    // Write the script and spawn it. setsid detaches into a new session
    // so it survives the Node parent + the admin container restarting.
    // </dev/null + redirect everything else so no fd is held open back
    // to the parent's tty/log.
    const script = [
        '#!/bin/bash',
        'set +e',
        `echo "[switchover] scheduled $(date -u --iso-8601=seconds), sleeping ${SWITCHOVER_DELAY_SEC}s before teardown" >> ${SWITCHOVER_LOG_PATH}`,
        `sleep ${SWITCHOVER_DELAY_SEC}`,
        `echo "[switchover] tearing down yundera stack at $(date -u --iso-8601=seconds)" >> ${SWITCHOVER_LOG_PATH}`,
        `sudo -n docker compose -f ${YUNDERA_COMPOSE} down --remove-orphans >> ${SWITCHOVER_LOG_PATH} 2>&1`,
        `echo "[switchover] done at $(date -u --iso-8601=seconds)" >> ${SWITCHOVER_LOG_PATH}`,
        '',
    ].join('\n');

    // Build a single shell command that:
    //   1. Writes the script atomically
    //   2. Makes it executable
    //   3. Spawns it fully detached
    // Pass the script body via base64 so we don't have to escape it
    // through HostExecutor's command pipeline.
    const scriptB64 = Buffer.from(script, 'utf8').toString('base64');
    // Why a subshell for the spawn line: joining "setsid … &" with " && disown"
    // produces "setsid … & && disown" — bash treats "& &&" as a syntax error and
    // the whole one-liner aborts before any of it runs (we saw exactly that
    // failure in a migration: "syntax error near unexpected token `&&'"). The
    // subshell `(setsid … &)` runs the spawn-and-backgrounding inside a child
    // shell that exits immediately, leaving the detached script alive. setsid
    // already starts a new session so SIGHUP from the parent shell exiting
    // won't reach it — explicit `disown` is unnecessary.
    const remoteCmd = [
        `echo ${scriptB64} | base64 -d > ${SWITCHOVER_SCRIPT_PATH}`,
        `chmod +x ${SWITCHOVER_SCRIPT_PATH}`,
        `(setsid ${SWITCHOVER_SCRIPT_PATH} </dev/null >>${SWITCHOVER_LOG_PATH} 2>&1 &)`,
        // Sanity check: the script file should exist now. If this fails,
        // the spawn was the problem and we want to fail the step loudly.
        `test -x ${SWITCHOVER_SCRIPT_PATH}`,
    ].join(' && ');

    await executeHostCommand(remoteCmd, { timeout: 15_000 });
}
