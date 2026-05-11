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
import { fireWebhook } from './steps/webhook';
import { scheduleSwitchover } from './steps/switchover';
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

export async function getMigrationStatus(): Promise<MigrationStatus> {
    return state;
}

export async function requestCancel(): Promise<void> {
    state = { ...state, cancelRequested: true };
}

async function setPhase(phase: MigrationPhase, patch: Partial<MigrationStatus> = {}): Promise<void> {
    state = { ...state, phase, ...patch };
}

async function setStep(key: string, status: MigrationStepStatus, message?: string): Promise<void> {
    const now = new Date();
    const existing = state.steps[key];
    const step: MigrationStep = {
        name: key,
        status,
        message,
        startedAt: status === 'running' ? now : existing?.startedAt,
        finishedAt:
            status === 'success' || status === 'failed' || status === 'skipped'
                ? now
                : existing?.finishedAt,
    };
    state = { ...state, steps: { ...state.steps, [key]: step } };
}

export async function updateRsyncProgress(p: RsyncProgress): Promise<void> {
    state = { ...state, rsync: p };
}

async function isCancelled(): Promise<boolean> {
    return state.cancelRequested;
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
        await setStep('online_rsync', 'success');
        if (await isCancelled()) throw new Error('Cancelled');

        // ---- Pre-pull docker images on target ----
        await setStep('docker_pull', 'running');
        await setPhase('docker_pull');
        const pulled = await pullImagesOnTarget(keypair, req.host);
        await setStep('docker_pull', 'success', `Pulled ${pulled.length} images on target`);
        if (await isCancelled()) throw new Error('Cancelled');

        // ---- Stop source (LOCAL — bring our own apps + cron down) ----
        await setStep('stop_source', 'running');
        await setPhase('stop_source');
        await stopSource();
        sourceStopped = true;
        await setStep('stop_source', 'success');
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
        await setStep('offline_rsync', 'success');
        if (await isCancelled()) throw new Error('Cancelled');

        // ---- Trigger self-check on target (handover) ----
        await setStep('target_self_check', 'running');
        await setPhase('target_self_check');
        await triggerTargetSelfCheck(keypair, req.host);
        await setStep('target_self_check', 'success');

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
        await startUserAppsOnTarget(keypair, req.host);
        await setStep('start_user_apps', 'success');

        // ---- Cleanup (remove our SSH key from the target migration user) ----
        await setStep('cleanup', 'running');
        await setPhase('cleanup');
        await cleanupMigrationKey(keypair, req);
        keypair = undefined;
        await setStep('cleanup', 'success');

        // ---- Switchover (schedule source-side teardown of the yundera
        // system stack so target becomes the sole mesh-router agent for
        // this domain). `scheduleSwitchover` only schedules a detached
        // teardown with a ~60s delay; the admin process running this
        // pipeline stays alive long enough to fire the webhook below and
        // write phase=done. See switchover.ts header.
        await setStep('switchover', 'running');
        await setPhase('switchover');
        try {
            await scheduleSwitchover();
            await setStep('switchover', 'success', 'Source teardown scheduled (will go silent in ~60s)');
        } catch (swErr) {
            // Don't blow up the whole migration if scheduling the
            // switchover failed — the migration data is already on
            // target and the orchestrator can drive a manual cutover
            // (the operator runs `compose down` from any SSH session).
            const swMsg = swErr instanceof Error ? swErr.message : String(swErr);
            console.error('[Migration] schedule switchover failed:', swMsg);
            await setStep('switchover', 'failed', `Scheduling failed: ${swMsg}. Bring down /DATA/AppData/casaos/apps/yundera manually before promoting.`);
        }

        // ---- Webhook (final hand-off signal — last step) ----
        // The orchestrator's webhook handler runs `promoteMigrationAndDelete-
        // Source`, which renames the target to `pcs-<pcsId>` and soft-deletes
        // this source via the Contabo API. That hard-stop will likely race
        // ahead of the 60s detached teardown scheduled above, which is fine —
        // both paths converge on "source goes silent." When ORCHESTRATOR_PUBLIC
        // _URL is unset (typical in dev), the step records 'skipped' and the
        // user clicks the dashboard's "Complete migration" button, which hits
        // the same promote path.
        if (req.webhookUrl) {
            await setStep('webhook', 'running');
            await setPhase('webhook');
            const current = await getMigrationStatus();
            await fireWebhook(req.webhookUrl, { status: 'success', startedAt: current.startedAt });
            await setStep('webhook', 'success');
        } else {
            await setStep('webhook', 'skipped', 'No webhook URL configured');
        }

        await setPhase('done', { finishedAt: new Date() });
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

        // Fire failure webhook
        if (req.webhookUrl) {
            try {
                await fireWebhook(req.webhookUrl, { status: 'failed', error: msg });
            } catch (webhookErr) {
                console.error('[Migration] failure webhook errored:', webhookErr);
            }
        }
    }
}
