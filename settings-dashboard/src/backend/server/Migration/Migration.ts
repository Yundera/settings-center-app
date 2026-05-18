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
import { verifyDestination } from './steps/verifyDestination';
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
        const pullResult = await pullImagesOnTarget(keypair, req.host);
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

        // ---- Verify destination serves the domain (pre-cutover check) ----
        // Validates BEFORE switchover that the target is ready to take over:
        // (a) HTTPS-probes the target's IP with the user's FQDN as Host —
        //     proves caddy on the target routes the right vhost to the
        //     right container, independent of DNS / CF / gateway.
        // (b) Queries the mesh-router-backend's resolve endpoint to confirm
        //     the target's agent has registered its IP under the user's
        //     domain — without this, traffic won't actually flip once the
        //     source goes silent.
        // Failure here aborts the migration with rollback, while the source
        // is still serving and recovery is cheap. The orchestrator's
        // post-cutover waitForDomainReady is a *secondary* check after
        // promote; this one is the primary pre-flight.
        await setStep('verify_destination', 'running');
        await setPhase('verify_destination');
        const {userDomain, serverDomain} = splitDomain(process.env.DOMAIN || process.env.PCS_DOMAIN || '');
        if (!userDomain || !serverDomain) {
            await setStep('verify_destination', 'skipped',
                `Could not parse DOMAIN env (got "${process.env.DOMAIN ?? ''}") — skipping pre-cutover check`);
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
