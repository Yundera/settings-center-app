import { JsonFileContext } from '../SimpleMutex';
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
import { fireWebhook } from './steps/webhook';
import { MigrationKeyPair } from './MigrationSSH';

const DEFAULT_STATUS: MigrationStatus = {
    phase: 'idle',
    steps: {},
    cancelRequested: false,
};

let context: JsonFileContext<MigrationStatus> | null = null;

export async function getContext(): Promise<JsonFileContext<MigrationStatus>> {
    if (!context) {
        context = new JsonFileContext('migration-status', DEFAULT_STATUS);
        await context.initialize();
    }
    return context;
}

export async function getMigrationStatus(): Promise<MigrationStatus> {
    const ctx = await getContext();
    return ctx.read();
}

export async function requestCancel(): Promise<void> {
    const ctx = await getContext();
    await ctx.update(s => ({ ...s, cancelRequested: true }));
}

async function setPhase(phase: MigrationPhase, patch: Partial<MigrationStatus> = {}): Promise<void> {
    const ctx = await getContext();
    await ctx.update(s => ({ ...s, phase, ...patch }));
}

async function setStep(key: string, status: MigrationStepStatus, message?: string): Promise<void> {
    const ctx = await getContext();
    await ctx.update(s => {
        const now = new Date();
        const existing = s.steps[key];
        const step: MigrationStep = {
            name: key,
            status,
            message,
            startedAt: status === 'running' ? now : existing?.startedAt,
            finishedAt: status === 'success' || status === 'failed' || status === 'skipped' ? now : existing?.finishedAt,
        };
        return { ...s, steps: { ...s.steps, [key]: step } };
    });
}

export async function updateRsyncProgress(p: RsyncProgress): Promise<void> {
    const ctx = await getContext();
    await ctx.update(s => ({ ...s, rsync: p }));
}

async function isCancelled(): Promise<boolean> {
    const ctx = await getContext();
    const s = await ctx.read();
    return s.cancelRequested;
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
    const ctx = await getContext();

    let canStart = false;
    await ctx.update(s => {
        if (isActivePhase(s.phase)) {
            return s;
        }
        canStart = true;
        const steps: Record<string, MigrationStep> = {};
        for (const { key } of MIGRATION_STEPS) {
            steps[key] = { name: key, status: 'pending' };
        }
        return {
            ...DEFAULT_STATUS,
            phase: 'preflight',
            startedAt: new Date(),
            target: { host: req.host, user: req.user },
            webhookUrl: req.webhookUrl,
            triggeredBy: req.triggeredBy ?? 'ui',
            steps,
            cancelRequested: false,
        };
    });

    if (!canStart) {
        throw new Error('A migration is already in progress');
    }

    // Fire-and-forget; errors are recorded in state
    runMigration(req).catch(err => {
        console.error('[Migration] unhandled error:', err);
    });

    return ctx.read();
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

        // ---- Webhook ----
        if (req.webhookUrl) {
            await setStep('webhook', 'running');
            await setPhase('webhook');
            const current = await getMigrationStatus();
            await fireWebhook(req.webhookUrl, { status: 'success', startedAt: current.startedAt });
            await setStep('webhook', 'success');
        } else {
            await setStep('webhook', 'skipped', 'No webhook URL configured');
        }

        // ---- Cleanup (remove our SSH key from the target migration user) ----
        await setStep('cleanup', 'running');
        await setPhase('cleanup');
        await cleanupMigrationKey(keypair, req);
        keypair = undefined;
        await setStep('cleanup', 'success');

        await setPhase('done', { finishedAt: new Date() });
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);

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
