import { FileMutexContext } from '../FileMutexContext';

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
    integrityCheck?: SelfCheckResult;
}

class SelfCheckContext extends FileMutexContext<SelfCheckStatus> {
    private static instance: SelfCheckContext;

    protected defaultData: SelfCheckStatus = {
        isRunning: false,
        overallStatus: 'never_run',
        scripts: {}
    };

    private constructor() {
        super('selfcheck-context');
    }

    public static getInstance(): SelfCheckContext {
        if (!SelfCheckContext.instance) {
            SelfCheckContext.instance = new SelfCheckContext();
        }
        return SelfCheckContext.instance;
    }

    // Validation
    protected validateData(data: any): SelfCheckStatus {
        if (typeof data !== 'object' || data === null) {
            throw new Error('SelfCheckStatus must be an object');
        }

        if (typeof data.isRunning !== 'boolean') {
            throw new Error('isRunning must be a boolean');
        }

        if (!['success', 'failure', 'partial', 'never_run'].includes(data.overallStatus)) {
            throw new Error('overallStatus must be one of: success, failure, partial, never_run');
        }

        if (typeof data.scripts !== 'object' || data.scripts === null) {
            throw new Error('scripts must be an object');
        }

        return data as SelfCheckStatus;
    }

    // Serialization
    protected serializeData(data: SelfCheckStatus): any {
        return {
            ...data,
            lastRun: data.lastRun?.toISOString(),
            scripts: Object.fromEntries(
                Object.entries(data.scripts).map(([key, value]) => [
                    key,
                    { ...value, timestamp: value.timestamp.toISOString() }
                ])
            ),
            integrityCheck: data.integrityCheck ? {
                ...data.integrityCheck,
                timestamp: data.integrityCheck.timestamp.toISOString()
            } : undefined
        };
    }

    // Deserialization
    protected deserializeData(data: any): SelfCheckStatus {
        return {
            ...data,
            lastRun: data.lastRun ? new Date(data.lastRun) : undefined,
            scripts: Object.fromEntries(
                Object.entries(data.scripts || {}).map(([key, value]: [string, any]) => [
                    key,
                    { ...value, timestamp: new Date(value.timestamp) }
                ])
            ),
            integrityCheck: data.integrityCheck ? {
                ...data.integrityCheck,
                timestamp: new Date(data.integrityCheck.timestamp)
            } : undefined
        };
    }

    // Self-check specific methods

    /**
     * Atomically try to set self-check to running state
     * @returns true if successfully set to running, false if already running
     */
    public async tryStartSelfCheck(): Promise<boolean> {
        return this.withWriteLock(data => {
            if (data.isRunning) {
                return { data, result: false };
            }

            return {
                data: {
                    ...data,
                    isRunning: true,
                    lastRun: new Date(),
                    overallStatus: 'never_run',
                    scripts: {},
                    integrityCheck: undefined
                },
                result: true
            };
        });
    }

    /**
     * Update a specific script result atomically
     */
    public async updateScriptResult(scriptName: string, result: SelfCheckResult): Promise<void> {
        await this.withWriteLock(data => ({
            data: {
                ...data,
                scripts: {
                    ...data.scripts,
                    [scriptName]: { ...result }
                }
            },
            result: undefined
        }));
    }

    /**
     * Set the integrity check result
     */
    public async setIntegrityCheckResult(result: SelfCheckResult): Promise<void> {
        await this.withWriteLock(data => ({
            data: {
                ...data,
                integrityCheck: { ...result }
            },
            result: undefined
        }));
    }

    /**
     * Finalize self-check with overall status
     */
    public async finalizeSelfCheck(overallStatus: 'success' | 'failure' | 'partial'): Promise<void> {
        await this.withWriteLock(data => ({
            data: {
                ...data,
                isRunning: false,
                overallStatus
            },
            result: undefined
        }));
    }

    /**
     * Get the current running state
     */
    public async isRunning(): Promise<boolean> {
        return this.withReadLock(data => data.isRunning);
    }

    /**
     * Get script results
     */
    public async getScriptResults(): Promise<Record<string, SelfCheckResult>> {
        return this.withReadLock(data => ({ ...data.scripts }));
    }

    /**
     * Get specific script result
     */
    public async getScriptResult(scriptName: string): Promise<SelfCheckResult | undefined> {
        return this.withReadLock(data => data.scripts[scriptName] ? { ...data.scripts[scriptName] } : undefined);
    }

    /**
     * Get integrity check result
     */
    public async getIntegrityCheckResult(): Promise<SelfCheckResult | undefined> {
        return this.withReadLock(data => data.integrityCheck ? { ...data.integrityCheck } : undefined);
    }

    /**
     * Get overall status
     */
    public async getOverallStatus(): Promise<'success' | 'failure' | 'partial' | 'never_run'> {
        return this.withReadLock(data => data.overallStatus);
    }

    /**
     * Get last run timestamp
     */
    public async getLastRun(): Promise<Date | undefined> {
        return this.withReadLock(data => data.lastRun ? new Date(data.lastRun) : undefined);
    }

    /**
     * Reset self-check status (for testing or manual reset)
     */
    public async reset(): Promise<void> {
        await this.withWriteLock(() => ({
            data: { ...this.defaultData },
            result: undefined
        }));
    }

    /**
     * Get summary statistics
     */
    public async getSummary(): Promise<{
        totalScripts: number;
        successCount: number;
        failureCount: number;
        isRunning: boolean;
        overallStatus: string;
        lastRun?: Date;
    }> {
        return this.withReadLock(data => {
            const scriptResults = Object.values(data.scripts);
            return {
                totalScripts: scriptResults.length,
                successCount: scriptResults.filter(r => r.success).length,
                failureCount: scriptResults.filter(r => !r.success).length,
                isRunning: data.isRunning,
                overallStatus: data.overallStatus,
                lastRun: data.lastRun ? new Date(data.lastRun) : undefined
            };
        });
    }
}

export default SelfCheckContext;