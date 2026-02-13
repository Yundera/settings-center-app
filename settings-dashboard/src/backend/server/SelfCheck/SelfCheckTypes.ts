export interface SelfCheckResult {
    success: boolean;
    message: string;
    timestamp: Date;
    duration?: number;
}

export interface SelfCheckStatus {
    lastRun?: Date;
    isRunning: boolean;
    overallStatus: 'success' | 'failure' | 'partial' | 'never_run' | 'connection_failed';
    connectionError?: string;
    scripts: Record<string, SelfCheckResult>;
}