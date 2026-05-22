import {
    MigrationStatus,
    MigrationRequest,
    MigrationPhase,
    MigrationStep,
    MigrationStepStatus,
    RsyncProgress,
    MIGRATION_STEPS,
} from './MigrationTypes';
import { runPreflight } from './steps/preflight';
import { pushMigrationKey, cleanupMigrationKey } from './steps/pushKey';
import { runRsync } from './steps/rsync';
import { pullImagesOnTarget } from './steps/dockerPull';
import { stopSource, restartSource } from './steps/stopSource';
import { triggerTargetSelfCheck } from './steps/targetSelfCheck';
import { startUserAppsOnTarget } from './steps/startUserApps';
import { deregisterSource } from './steps/deregisterSource';
import { verifyDestination } from './steps/verifyDestination';
import { scheduleSourceDown } from './steps/sourceDown';
import { startStatusPusher, StatusPusher } from './MigrationStatusPush';
import { MigrationKeyPair } from './MigrationSSH';

const DEFAULT_STATUS: MigrationStatus = {
    phase: 'idle',
    steps: {},
    cancelRequested: false,
};

// In-memory state. The migration runs as async work inside this Node
// process (rsync child + pipeline orchestration), so durability across
// admin restarts is not achievable here regardless of where state lives —
// killing the process kills the migration. Persisting to a JSON file
// caused write storms during rsync progress updates that corrupted the
// file and lost step history. Going pure in-memory: state is honest
// (matches what the process is actually doing), no FS I/O, no atomic
// rename races. Long-running terminal state lives orchestrator-side
// (Firestore migrationAutoStatus + target PCS record) for cross-restart
// visibility.
let state: MigrationStatus = { ...DEFAULT_STATUS };

// Set for the duration of a runMigration() call. setPhase / setStep /
// updateRsyncProgress notify it after every state mutation; the pusher
// coalesces those into throttled + heartbeat POSTs to the orchestrator.
let activePusher: StatusPusher | null = null;

export async function getMigrationStatus(): Promise<MigrationStatus> {
    return state;
}

export async function requestCancel(): Promise<void> {
    state = { ...state, cancelRequested: true };
}

async function setPhase(phase: MigrationPhase, patch: Partial<MigrationStatus> = {}): Promise<void> {
    state = { ...state, phase, ...patch };
    activePusher?.notify();
}

async function setStep(key: string, status: MigrationStepStatus, message?: string): Promise<void> {
    const now = new Date();
    const existing = state.steps[key];
    const step: MigrationStep = {
        name: key,
        status,
        message,
        // Preserve startedAt across repeated 'running' calls — steps that
        // push live progress (e.g. docker_pull's per-stack message) re-enter
        // setStep with 'running' many times; only the first should stamp the
        // start time.
        startedAt: status === 'running' ? (existing?.startedAt ?? now) : existing?.startedAt,
        finishedAt:
            status === 'success' || status === 'failed' || status === 'skipped'
                ? now
                : existing?.finishedAt,
    };
    state = { ...state, steps: { ...state.steps, [key]: step } };
    activePusher?.notify();
}

export async function updateRsyncProgress(p: RsyncProgress): Promise<void> {
    state = { ...state, rsync: p };
    activePusher?.notify();
}

async function isCancelled(): Promise<boolean> {
    return state.cancelRequested;
}

/**
 * Format the final rsync state into a short human message for setStep().
 * The orchestrator's source pipeline emits `RsyncProgress.bytesTransferred`
 * on every progress2 line — the *last* value before rsync exits is the
 * total bytes pushed in that pass. Using it as a step.message gives the
 * operator a concrete "X GB transferred" sub-line in the dashboard's step
 * list (matches the live rsync chip while the step is running).
 */
function describeRsyncResult(
    rsync: RsyncProgress | undefined,
    verb: string,
    suffix: string,
): string {
    if (!rsync || !rsync.bytesTransferred || rsync.bytesTransferred <= 0) {
        return `${verb} ${suffix}`;
    }
    return `${verb} ${humanBytes(rsync.bytesTransferred)} ${suffix}`;
}

function humanBytes(n: number): string {
    if (!Number.isFinite(n) || n <= 0) return '0B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let v = n;
    let i = 0;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return `${v.toFixed(i <= 1 ? 0 : 1)}${units[i]}`;
}

/**
 * Split "wisera.inojob.com" → {userDomain: "wisera", serverDomain: "inojob.com"}.
 * The mesh-router-backend resolves on the user-domain piece alone (everything
 * before the first dot); everything after the first dot is the server zone
 * the backend lives under. Returns empty strings if the input doesn't have
 * the expected shape — caller should treat as "skip the check".
 */
function splitDomain(fqdn: string): {userDomain: string; serverDomain: string} {
    const idx = fqdn.indexOf('.');
    if (idx <= 0 || idx === fqdn.length - 1) return {userDomain: '', serverDomain: ''};
    return {userDomain: fqdn.slice(0, idx), serverDomain: fqdn.slice(idx + 1)};
}

/**
 * Starts a migration. Returns immediately with the initial status; the job
 * runs asynchronously and progress is observable via getMigrationStatus.
 *
 * THIS PCS is the source — it pushes its data to the target identified by
 * req.host using the target's pre-existing migration sudoer account
 * (req.user / req.password).
 *
 * Throws if a migration is already in flight.
 */
export async function startMigration(req: MigrationRequest): Promise<MigrationStatus> {
    // Single-runtime guard: if a migration is mid-flight in this process,
    // refuse. Node is single-threaded so this read+write doesn't race.
    if (isActivePhase(state.phase)) {
        throw new Error('A migration is already in progress');
    }

    const steps: Record<string, MigrationStep> = {};
    for (const { key } of MIGRATION_STEPS) {
        steps[key] = { name: key, status: 'pending' };
    }
    state = {
        ...DEFAULT_STATUS,
        phase: 'preflight',
        startedAt: new Date(),
        target: { host: req.host, user: req.user },
        webhookUrl: req.webhookUrl,
        triggeredBy: req.triggeredBy ?? 'ui',
        steps,
        cancelRequested: false,
    };

    // Fire-and-forget; errors are recorded in state
    runMigration(req).catch(err => {
        console.error('[Migration] unhandled error:', err);
    });

    return state;
}

function isActivePhase(phase: MigrationPhase): boolean {
    return phase !== 'idle' && phase !== 'done' && phase !== 'failed' && phase !== 'rolled_back';
}

async function runMigration(req: MigrationRequest): Promise<void> {
    let keypair: MigrationKeyPair | undefined;
    let sourceStopped = false;

    // Status push: setStep / setPhase / updateRsyncProgress notify this
    // pusher, which coalesces + heartbeats full-snapshot POSTs to the
    // orchestrator. After `deregister_source` the source is unreachable via
    // its own domain, so this outbound push is the only status channel left.
    const pusher = startStatusPusher(req.webhookUrl, () => state);
    activePusher = pusher;

    try {
        // ---- Preflight ----
        await setStep('preflight', 'running');
        await setPhase('preflight');
        const preflight = await runPreflight(req);
        if (!preflight.ok) {
            const firstFail = preflight.checks.find(c => !c.ok);
            throw new Error(`Preflight failed: ${firstFail?.name || 'unknown'} — ${firstFail?.message || ''}`);
        }
        await setStep('preflight', 'success', `${preflight.checks.length} checks passed`);
        if (await isCancelled()) throw new Error('Cancelled');

        // ---- Push SSH key onto target migration account ----
        await setStep('push_key', 'running');
        await setPhase('push_key');
        keypair = await pushMigrationKey(req);
        await setStep('push_key', 'success', `SSH key installed for '${keypair.migrationUser}' on target`);
        if (await isCancelled()) throw new Error('Cancelled');

        // ---- Online rsync (source → target, source still serving) ----
        await setStep('online_rsync', 'running');
        await setPhase('online_rsync');
        await runRsync({
            keypair,
            target: req.host,
            deleteFlag: false,
            onProgress: updateRsyncProgress,
            isCancelled,
        });
        await setStep('online_rsync', 'success',
            describeRsyncResult(state.rsync, 'pushed', `to ${req.host}`));
        if (await isCancelled()) throw new Error('Cancelled');

        // ---- Pre-pull docker images on target (per compose stack) ----
        await setStep('docker_pull', 'running');
        await setPhase('docker_pull');
        const pullResult = await pullImagesOnTarget(keypair, req.host, (msg) => {
            void setStep('docker_pull', 'running', msg);
        });
        const pullMsgParts: string[] = [];
        if (pullResult.installedDocker) pullMsgParts.push('docker installed');
        if (pullResult.composeFilesPulled.length > 0) {
            pullMsgParts.push(`pulled images for ${pullResult.composeFilesPulled.length} stack${pullResult.composeFilesPulled.length === 1 ? '' : 's'}`);
        }
        if (pullResult.failedFiles.length > 0) {
            pullMsgParts.push(`${pullResult.failedFiles.length} failed (will retry during self-check)`);
        }
        if (pullResult.composeFilesPulled.length === 0 && pullResult.failedFiles.length === 0) {
            pullMsgParts.push('no compose files found');
        }
        await setStep('docker_pull', 'success', pullMsgParts.join(' · '));
        if (await isCancelled()) throw new Error('Cancelled');

        // ---- Stop source (LOCAL — bring our own apps + cron down) ----
        await setStep('stop_source', 'running');
        await setPhase('stop_source');
        await stopSource();
        sourceStopped = true;
        await setStep('stop_source', 'success',
            'User compose stacks stopped, self-check cron disabled — source data is quiescent');
        if (await isCancelled()) throw new Error('Cancelled');

        // ---- Offline diff rsync (with --delete) ----
        await setStep('offline_rsync', 'running');
        await setPhase('offline_rsync');
        await runRsync({
            keypair,
            target: req.host,
            deleteFlag: true,
            onProgress: updateRsyncProgress,
            isCancelled,
        });
        await setStep('offline_rsync', 'success',
            describeRsyncResult(state.rsync, 'synced delta', `with --delete`));
        if (await isCancelled()) throw new Error('Cancelled');

        // ---- Trigger self-check on target (handover) ----
        await setStep('target_self_check', 'running');
        await setPhase('target_self_check');
        await triggerTargetSelfCheck(keypair, req.host);
        await setStep('target_self_check', 'success',
            'ensure-*.sh chain ran — target users created, docker installed, system stack up');

        // ---- Start user apps on target ----
        // Brings up the per-app docker compose stacks that were rsynced into
        // /DATA/AppData/casaos/apps/<app>/. The target's normal self-check
        // (above) only re-renders compose for apps already running — correct
        // on a healthy box but wrong post-migration, when nothing is running
        // yet because the apps just landed via rsync. This step calls the
        // same script with FORCE_START=1 to bypass that gate exactly once.
        // Runs AFTER target_self_check so the target's .env has been
        // regenerated with the target's IP/domain (ensure-public-ip.sh ran
        // during the self-check) — env injection uses the new host's values,
        // not the rsynced source values.
        await setStep('start_user_apps', 'running');
        await setPhase('start_user_apps');
        const startResult = await startUserAppsOnTarget(keypair, req.host);
        if (startResult.failedApps.length > 0) {
            // Per-app failures (typically a deleted/renamed upstream image)
            // are NOT migration-fatal — the target data is already in place
            // and `verify_destination` below is the safety net for the user's
            // primary serving domain. Report the list on the step message so
            // the dashboard surfaces it; user reinstalls the listed apps
            // after the migration completes.
            const list = startResult.failedApps
                .map(a => `${a.name} (${a.reason})`)
                .join(', ');
            await setStep('start_user_apps', 'success',
                `${startResult.failedApps.length} app(s) failed to start — migration continues. User must reinstall: ${list}`);
        } else {
            await setStep('start_user_apps', 'success',
                'docker compose up -d ran for every user app with the target\'s env');
        }

        // ---- Deregister source (the cutover — LOCAL on this PCS) ----
        // Stop the yundera system stack except `admin`: the source's
        // mesh-router-agent goes down, so the destination (publishing since
        // target_self_check) owns the route uncontested. `admin` stays up to
        // finish this pipeline and keep pushing status. See deregisterSource.ts.
        await setStep('deregister_source', 'running');
        await setPhase('deregister_source');
        await deregisterSource();
        await setStep('deregister_source', 'success',
            'Source system stack stopped (admin excluded) — source mesh-router silenced');
        if (await isCancelled()) throw new Error('Cancelled');

        // ---- Verify destination serves the domain (post-cutover check) ----
        // Runs AFTER deregister_source, so the route is uncontested. Two hard
        // gates, both must pass or the migration rolls back: the destination's
        // admin app answers /api/health (the authoritative gate), and
        // mesh-router-backend resolves the user's domain to the destination
        // IP. A failure here still rolls back cheaply — the source's stack is
        // only stopped, not destroyed. See verifyDestination.ts.
        await setStep('verify_destination', 'running');
        await setPhase('verify_destination');
        const {userDomain, serverDomain} = splitDomain(process.env.DOMAIN || process.env.PCS_DOMAIN || '');
        if (!userDomain || !serverDomain) {
            await setStep('verify_destination', 'skipped',
                `Could not parse DOMAIN env (got "${process.env.DOMAIN ?? ''}") — skipping post-cutover check`);
        } else {
            const verifyResult = await verifyDestination(keypair, req.host, userDomain, serverDomain);
            if (!verifyResult.ok) {
                throw new Error(`Destination verification failed — ${verifyResult.summary}`);
            }
            await setStep('verify_destination', 'success', verifyResult.summary);
        }

        // ---- Revoke target migration access (remove our SSH key) ----
        await setStep('cleanup', 'running');
        await setPhase('cleanup');
        await cleanupMigrationKey(keypair, req);
        keypair = undefined;
        await setStep('cleanup', 'success',
            'Migration SSH key removed from target — source can no longer reach it');

        // ---- Source down (schedule detached teardown of `admin`) ----
        // `deregister_source` already stopped the rest of the system stack;
        // this schedules a detached, delayed `stop admin` so the pipeline can
        // finish (terminal push below) before `admin` — the process running
        // it — goes away. See sourceDown.ts.
        await setStep('source_down', 'running');
        await setPhase('source_down');
        try {
            await scheduleSourceDown();
            await setStep('source_down', 'success', 'Admin teardown scheduled (source goes fully silent in ~60s)');
        } catch (sdErr) {
            // Non-fatal: the migration data is already on the target. The
            // orchestrator's promote + Contabo-API stop silences the source
            // anyway; an operator can also stop `admin` from any SSH session.
            const sdMsg = sdErr instanceof Error ? sdErr.message : String(sdErr);
            console.error('[Migration] schedule source_down failed:', sdMsg);
            await setStep('source_down', 'failed',
                `Scheduling failed: ${sdMsg}. Stop the admin container at /DATA/AppData/casaos/apps/yundera manually.`);
        }

        // ---- Webhook (terminal status push — last step) ----
        // The push below carries phase=done; the orchestrator's
        // migration-callback handler promotes the destination and soft-deletes
        // this source on receipt. With no callback URL configured (dev /
        // Path A) the push is a no-op and the user clicks the dashboard's
        // "Complete migration" button, which hits the same promote path.
        await setStep('webhook', 'running');
        await setPhase('webhook');
        if (req.webhookUrl) {
            await setStep('webhook', 'success', 'Terminal status pushed to orchestrator');
        } else {
            await setStep('webhook', 'skipped',
                'No orchestrator callback URL — finish via the dashboard "Complete migration" button');
        }

        await setPhase('done', { finishedAt: new Date() });
        // Flush the terminal (phase=done) snapshot synchronously, before the
        // detached source_down script stops `admin`.
        await pusher.flushTerminal();
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);

        // Whichever step was 'running' when we threw is the one that failed.
        // Without this the dashboard keeps showing a spinner on that step
        // even though the overall phase is 'failed'/'rolled_back'.
        const runningKey = Object.keys(state.steps).find(k => state.steps[k]?.status === 'running');
        if (runningKey) {
            await setStep(runningKey, 'failed', msg);
        }

        if (sourceStopped) {
            // Rollback: bring source back up so the user has a serving PCS.
            // restartSource() also restarts the yundera system stack, which
            // deregister_source may have stopped.
            await setPhase('rolling_back', { error: msg });
            try {
                await restartSource();
            } catch (rollbackErr) {
                console.error('[Migration] rollback restart-source failed:', rollbackErr);
            }
            await setPhase('rolled_back', { finishedAt: new Date() });
        } else {
            await setPhase('failed', { error: msg, finishedAt: new Date() });
        }

        // Best-effort cleanup of the SSH key we installed on the target
        if (keypair) {
            try {
                await cleanupMigrationKey(keypair, req);
                keypair = undefined;
            } catch (cleanupErr) {
                console.error('[Migration] cleanup after failure errored:', cleanupErr);
            }
        }

        // Terminal failure push — the snapshot's phase is now 'failed' or
        // 'rolled_back'; the orchestrator records the failure and leaves the
        // callback token in place so the user can retry.
        try {
            await pusher.flushTerminal();
        } catch (pushErr) {
            console.error('[Migration] terminal failure push errored:', pushErr);
        }
    } finally {
        pusher.stop();
        activePusher = null;
    }
}
