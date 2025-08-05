export interface SelfCheckResult {
    success: boolean;
    message: string;
    timestamp: Date;
    duration?: number;
}

export interface SelfCheckStatus {
    lastRun?: Date;
    isRunning: boolean;
    overallStatus: 'success' | 'failure' | 'partial' | 'never_run';
    scripts: Record<string, SelfCheckResult>;
}