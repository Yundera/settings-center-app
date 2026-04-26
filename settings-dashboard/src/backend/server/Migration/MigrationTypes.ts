export type MigrationPhase =
    | 'idle'
    | 'preflight'
    | 'push_key'
    | 'online_rsync'
    | 'docker_pull'
    | 'stop_source'
    | 'offline_rsync'
    | 'target_self_check'
    | 'webhook'
    | 'cleanup'
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
    host: string;
    user: string;
    password: string;
    webhookUrl?: string;
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
    source?: {
        host: string;
        user: string;
    };
    webhookUrl?: string;
    steps: Record<string, MigrationStep>;
    rsync?: RsyncProgress;
    error?: string;
    cancelRequested: boolean;
    migrationAccount?: {
        name: string;
        createdOnSource: boolean;
    };
}

export const MIGRATION_STEPS: Array<{ key: string; label: string }> = [
    { key: 'preflight', label: 'Preflight checks' },
    { key: 'push_key', label: 'Create migration account + push SSH key' },
    { key: 'online_rsync', label: 'Online rsync (source live)' },
    { key: 'docker_pull', label: 'Pull Docker images on target' },
    { key: 'stop_source', label: 'Stop source containers + disable self-check cron' },
    { key: 'offline_rsync', label: 'Offline diff rsync' },
    { key: 'target_self_check', label: 'Run self-check on target' },
    { key: 'webhook', label: 'Fire webhook' },
    { key: 'cleanup', label: 'Cleanup (remove migration account)' },
];
