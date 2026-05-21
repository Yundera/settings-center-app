export type MigrationPhase =
    | 'idle'
    | 'preflight'
    | 'push_key'
    | 'online_rsync'
    | 'docker_pull'
    | 'stop_source'
    | 'offline_rsync'
    | 'target_self_check'
    | 'start_user_apps'
    | 'deregister_source'
    | 'verify_destination'
    | 'cleanup'
    | 'source_down'
    | 'webhook'
    | 'done'
    | 'failed'
    | 'rolling_back'
    | 'rolled_back';

export type MigrationStepStatus = 'pending' | 'running' | 'success' | 'failed' | 'skipped';

export interface MigrationStep {
    name: string;
    status: MigrationStepStatus;
    startedAt?: Date;
    finishedAt?: Date;
    message?: string;
}

export interface RsyncProgress {
    bytesTransferred: number;
    totalBytes?: number;
    percent?: number;
    throughput?: string;
    eta?: string;
    currentFile?: string;
}

export interface MigrationRequest {
    /** Target PCS host or IP — where this PCS will push its data. */
    host: string;
    /** Target migration user (typically `migration`, pre-created on the target via its UI). */
    user: string;
    /** Target migration user's password. Used once to install an SSH key. */
    password: string;
    webhookUrl?: string;
    /**
     * Who initiated this migration. 'ui' is the operator-driven Path A/B
     * flow via the admin panel. 'cli' is the orchestrator-driven Path C flow
     * via `docker exec admin … start-migration.ts`. Recorded into the status
     * file so support diagnostics can tell automated runs from manual ones.
     */
    triggeredBy?: 'ui' | 'cli';
}

export interface PreflightResult {
    ok: boolean;
    checks: Array<{
        name: string;
        ok: boolean;
        message: string;
    }>;
    sourceSizeBytes?: number;
    targetFreeBytes?: number;
    composeStacks?: string[];
    imageList?: string[];
}

export interface MigrationStatus {
    phase: MigrationPhase;
    startedAt?: Date;
    finishedAt?: Date;
    /** Target PCS the source pushed to. */
    target?: {
        host: string;
        user: string;
    };
    webhookUrl?: string;
    /** Who started this migration — see MigrationRequest.triggeredBy. */
    triggeredBy?: 'ui' | 'cli';
    steps: Record<string, MigrationStep>;
    rsync?: RsyncProgress;
    error?: string;
    cancelRequested: boolean;
}

// `webhook` is intentionally LAST: it is the terminal status push to the
// orchestrator (POST /pcs/migration-callback). The snapshot it carries has
// phase=done, which is what triggers promote + source soft-delete. The
// source-side cutover happens earlier, at `deregister_source` (the source's
// mesh-router stops); `verify_destination` then runs against the uncontested
// route. The pcs-dashboard MigrationCard mirrors this order; keep them in sync.
export const MIGRATION_STEPS: Array<{ key: string; label: string }> = [
    { key: 'preflight', label: 'Preflight checks' },
    { key: 'push_key', label: 'Install SSH key on target migration account' },
    { key: 'online_rsync', label: 'Online rsync (push to target)' },
    { key: 'docker_pull', label: 'Pull Docker images on target' },
    { key: 'stop_source', label: 'Stop user app stacks + disable self-check cron' },
    { key: 'offline_rsync', label: 'Offline diff rsync (push to target)' },
    { key: 'target_self_check', label: 'Run self-check on target' },
    { key: 'start_user_apps', label: 'Start user apps on target' },
    { key: 'deregister_source', label: 'Deregister source (stop system stack, source goes silent)' },
    { key: 'verify_destination', label: 'Verify destination serves domain' },
    { key: 'cleanup', label: 'Revoke target migration access' },
    { key: 'source_down', label: 'Source down (schedule admin teardown)' },
    { key: 'webhook', label: 'Signal orchestrator (terminal status push)' },
];
