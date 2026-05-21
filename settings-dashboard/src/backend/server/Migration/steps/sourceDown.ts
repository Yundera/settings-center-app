import { executeHostCommand } from '@/backend/cmd/HostExecutor';

/**
 * Final source-side teardown: stop the `admin` container — the last piece of
 * the source still running. `deregister_source` already stopped the rest of
 * the `yundera` system stack; this step finishes the job once the pipeline
 * no longer needs `admin` alive.
 *
 * Why detached: `admin` is the very process running this pipeline. Calling
 * `docker compose stop admin` synchronously would kill our own pid mid-step,
 * before the terminal status push (the `webhook` step) lands. The step
 * instead writes a small shell script and detaches it via `setsid` +
 * redirected std streams, so it outlives this Node process. The script
 * sleeps SOURCE_DOWN_DELAY_SEC before stopping `admin`, which is ample slack
 * for the terminal push + phase=done write to complete.
 *
 * Step ordering: `cleanup` runs before us (needs `admin` alive to SSH the
 * target). `webhook` (the terminal status push) runs AFTER us but only
 * *schedules* — the detached script's delay keeps `admin` alive long enough
 * for it. The orchestrator's promote + Contabo-API stop typically races
 * ahead of this detached stop anyway; both converge on "source is silent."
 *
 * Recovery: if anything downstream goes wrong, the source VPS is still alive
 * — only its containers are stopped. `docker compose -f
 * /DATA/AppData/casaos/apps/yundera/docker-compose.yml up -d` revives it.
 */

const YUNDERA_COMPOSE = '/DATA/AppData/casaos/apps/yundera/docker-compose.yml';
const SOURCE_DOWN_SCRIPT_PATH = '/tmp/migration-source-down.sh';
const SOURCE_DOWN_LOG_PATH = '/tmp/migration-source-down.log';

/**
 * Seconds the detached script sleeps before stopping `admin`. Generous —
 * only the terminal status push and the final phase=done write happen after
 * this step, both fast (<2s in practice).
 */
const SOURCE_DOWN_DELAY_SEC = 60;

export async function scheduleSourceDown(): Promise<void> {
    // setsid detaches into a new session so the script survives the Node
    // parent + the `admin` container stopping. </dev/null + redirects so no
    // fd is held open back to the parent's tty/log.
    const script = [
        '#!/bin/bash',
        'set +e',
        `echo "[source_down] scheduled $(date -u --iso-8601=seconds), sleeping ${SOURCE_DOWN_DELAY_SEC}s before stopping admin" >> ${SOURCE_DOWN_LOG_PATH}`,
        `sleep ${SOURCE_DOWN_DELAY_SEC}`,
        `echo "[source_down] stopping admin at $(date -u --iso-8601=seconds)" >> ${SOURCE_DOWN_LOG_PATH}`,
        `sudo -n docker compose -f ${YUNDERA_COMPOSE} stop admin >> ${SOURCE_DOWN_LOG_PATH} 2>&1`,
        `echo "[source_down] done at $(date -u --iso-8601=seconds)" >> ${SOURCE_DOWN_LOG_PATH}`,
        '',
    ].join('\n');

    // Write the script (base64 so the body survives HostExecutor's command
    // pipeline untouched), make it executable, and spawn it fully detached.
    const scriptB64 = Buffer.from(script, 'utf8').toString('base64');
    // The spawn line runs inside a subshell `(setsid … &)`: joining
    // "setsid … &" with "&& …" produces "& &&", a bash syntax error that
    // aborts the whole one-liner. The subshell backgrounds the spawn and
    // exits immediately, leaving the detached script alive. setsid already
    // starts a new session, so SIGHUP from the parent shell exiting won't
    // reach it.
    const remoteCmd = [
        `echo ${scriptB64} | base64 -d > ${SOURCE_DOWN_SCRIPT_PATH}`,
        `chmod +x ${SOURCE_DOWN_SCRIPT_PATH}`,
        `(setsid ${SOURCE_DOWN_SCRIPT_PATH} </dev/null >>${SOURCE_DOWN_LOG_PATH} 2>&1 &)`,
        // Sanity check: the script file should exist now. If this fails the
        // spawn was the problem and we want to fail the step loudly.
        `test -x ${SOURCE_DOWN_SCRIPT_PATH}`,
    ].join(' && ');

    await executeHostCommand(remoteCmd, { timeout: 15_000 });
}
