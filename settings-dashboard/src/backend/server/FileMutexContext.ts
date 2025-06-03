import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

interface LockInfo {
    pid: number;
    timestamp: number;
    hostname?: string;
    lockId: string; // Add unique lock identifier
}

export abstract class FileMutexContext<T> {
    protected dataFilePath: string;
    protected lockFilePath: string;
    protected cache: T | null = null;
    protected lastFileModTime: number = 0;
    protected abstract defaultData: T;

    // Lock configuration
    private readonly LOCK_TIMEOUT = 30000; // 30 seconds
    private readonly RETRY_DELAY = 100; // 100ms base delay
    private readonly MAX_RETRIES = 300; // 30 seconds total
    private readonly MAX_RETRY_JITTER = 50; // Add randomization

    constructor(fileName: string, baseDir: string = process.cwd()) {
        this.dataFilePath = path.join(baseDir, `${fileName}.json`);
        this.lockFilePath = path.join(baseDir, `${fileName}.lock`);
    }

    // Abstract methods that subclasses must implement
    protected abstract validateData(data: any): T;
    protected abstract serializeData(data: T): any;
    protected abstract deserializeData(data: any): T;

    // Generate unique lock ID for this acquisition attempt
    private generateLockId(): string {
        return `${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    }

    // Add jitter to reduce thundering herd
    private getRetryDelay(): number {
        return this.RETRY_DELAY + Math.floor(Math.random() * this.MAX_RETRY_JITTER);
    }

    // File-based mutex implementation
    private async acquireLock(): Promise<() => Promise<void>> {
        const lockId = this.generateLockId();
        const lockInfo: LockInfo = {
            pid: process.pid,
            timestamp: Date.now(),
            hostname: process.env.HOSTNAME || 'unknown',
            lockId
        };

        let retries = 0;
        while (retries < this.MAX_RETRIES) {
            try {
                // Try to create lock file exclusively
                await fs.writeFile(
                    this.lockFilePath,
                    JSON.stringify(lockInfo, null, 2),
                    { flag: 'wx' } // Exclusive write, fails if file exists
                );

                // Successfully acquired lock
                return async () => this.releaseLock(lockId);

            } catch (error: any) {
                if (error.code === 'EEXIST') {
                    // Lock file exists, check if it's stale
                    const staleLockRemoved = await this.handleExistingLock();

                    if (staleLockRemoved) {
                        // If we removed a stale lock, add extra delay to avoid immediate collision
                        await this.sleep(this.getRetryDelay() * 2);
                    } else {
                        // Lock is active, wait normally
                        await this.sleep(this.getRetryDelay());
                        retries++;
                    }
                } else {
                    throw error;
                }
            }
        }

        throw new Error(`Failed to acquire lock after ${this.MAX_RETRIES} retries (${this.MAX_RETRIES * this.RETRY_DELAY}ms)`);
    }

    private async handleExistingLock(): Promise<boolean> {
        try {
            const existingLockData = await fs.readFile(this.lockFilePath, 'utf-8');
            const existingLock: LockInfo = JSON.parse(existingLockData);

            // Check if lock is stale (older than timeout)
            const lockAge = Date.now() - existingLock.timestamp;
            if (lockAge > this.LOCK_TIMEOUT) {
                console.warn(`Attempting to remove stale lock from PID ${existingLock.pid} (${lockAge}ms old)`);

                // Use a more careful removal strategy
                return await this.removeStaleHolderIfExists(existingLock);
            }

            return false; // Lock is not stale

        } catch (parseError) {
            // Corrupted lock file, remove it
            console.warn('Removing corrupted lock file');
            await this.forceReleaseLock();
            return true;
        }
    }

    private async removeStaleHolderIfExists(existingLock: LockInfo): Promise<boolean> {
        try {
            // Double-check by re-reading the lock file to ensure it's still the same
            const currentLockData = await fs.readFile(this.lockFilePath, 'utf-8');
            const currentLock: LockInfo = JSON.parse(currentLockData);

            // Verify this is still the same lock we detected as stale
            if (currentLock.lockId === existingLock.lockId &&
                currentLock.pid === existingLock.pid &&
                currentLock.timestamp === existingLock.timestamp) {

                // Check age again in case time has passed
                const currentAge = Date.now() - currentLock.timestamp;
                if (currentAge > this.LOCK_TIMEOUT) {
                    await fs.unlink(this.lockFilePath);
                    console.warn(`Removed stale lock from PID ${existingLock.pid}`);
                    return true;
                }
            }

            // Lock changed or is no longer stale
            return false;

        } catch (error: any) {
            if (error.code === 'ENOENT') {
                // Lock file was already removed by another process
                return true;
            }
            // Some other error occurred, don't remove the lock
            console.warn('Failed to verify stale lock:', error.message);
            return false;
        }
    }

    private async releaseLock(expectedLockId?: string): Promise<void> {
        try {
            // Verify we're releasing our own lock
            if (expectedLockId) {
                try {
                    const lockData = await fs.readFile(this.lockFilePath, 'utf-8');
                    const lockInfo: LockInfo = JSON.parse(lockData);

                    if (lockInfo.lockId !== expectedLockId) {
                        console.warn(`Lock ID mismatch during release. Expected: ${expectedLockId}, Found: ${lockInfo.lockId}`);
                        return; // Don't release someone else's lock
                    }
                } catch (readError) {
                    // Lock file might have been removed already
                    return;
                }
            }

            await fs.unlink(this.lockFilePath);
        } catch (error: any) {
            if (error.code !== 'ENOENT') {
                console.warn('Failed to release lock:', error.message);
            }
        }
    }

    private async forceReleaseLock(): Promise<void> {
        try {
            await fs.unlink(this.lockFilePath);
        } catch (error: any) {
            if (error.code !== 'ENOENT') {
                console.warn('Failed to force release lock:', error.message);
            }
        }
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // File operations with better error handling
    private async ensureFileExists(): Promise<void> {
        try {
            await fs.access(this.dataFilePath);
        } catch {
            await this.writeToFileInternal(this.defaultData);
        }
    }

    private async checkFileModification(): Promise<boolean> {
        try {
            const stats = await fs.stat(this.dataFilePath);
            const currentModTime = stats.mtime.getTime();
            if (currentModTime !== this.lastFileModTime) {
                this.lastFileModTime = currentModTime;
                return true;
            }
            return false;
        } catch {
            return true;
        }
    }

    private async readFromFileInternal(): Promise<T> {
        try {
            await this.ensureFileExists();
            const data = await fs.readFile(this.dataFilePath, 'utf-8');
            const parsed = JSON.parse(data);
            return this.deserializeData(parsed);
        } catch (error) {
            console.warn(`Failed to read ${this.dataFilePath}, using defaults:`, (error as Error).message);
            return { ...this.defaultData };
        }
    }

    private async writeToFileInternal(data: T): Promise<void> {
        try {
            const tempFile = `${this.dataFilePath}.tmp.${Date.now()}.${process.pid}`;
            const serializedData = this.serializeData(data);
            await fs.writeFile(tempFile, JSON.stringify(serializedData, null, 2), 'utf-8');

            // Atomic move
            await fs.rename(tempFile, this.dataFilePath);

            // Update cache and mod time
            this.cache = { ...data };
            const stats = await fs.stat(this.dataFilePath);
            this.lastFileModTime = stats.mtime.getTime();
        } catch (error) {
            console.error(`Failed to write ${this.dataFilePath}:`, (error as Error).message);
            throw error;
        }
    }

    private async getDataInternal(): Promise<T> {
        if (this.cache && !(await this.checkFileModification())) {
            return { ...this.cache };
        }

        this.cache = await this.readFromFileInternal();
        return { ...this.cache };
    }

    // Protected methods for subclasses
    protected async withReadLock<R>(operation: (data: T) => R): Promise<R> {
        const release = await this.acquireLock();
        try {
            const data = await this.getDataInternal();
            return operation(data);
        } finally {
            await release();
        }
    }

    protected async withWriteLock<R>(operation: (data: T) => { data: T; result: R }): Promise<R> {
        const release = await this.acquireLock();
        try {
            const currentData = await this.getDataInternal();
            const { data: newData, result } = operation(currentData);

            // Validate data before writing
            this.validateData(newData);
            await this.writeToFileInternal(newData);
            return result;
        } finally {
            await release();
        }
    }

    // Public methods
    public async initialize(): Promise<void> {
        const release = await this.acquireLock();
        try {
            this.cache = await this.readFromFileInternal();
            console.log(`${this.constructor.name} initialized`);
        } finally {
            await release();
        }
    }

    public getDataSync(): T {
        if (this.cache) {
            return { ...this.cache };
        }
        return { ...this.defaultData };
    }

    public async getData(): Promise<T> {
        return this.withReadLock(data => ({ ...data }));
    }

    public async setData(newData: T): Promise<void> {
        await this.withWriteLock(() => ({
            data: { ...newData },
            result: undefined
        }));
    }

    // Cleanup method
    public async cleanup(): Promise<void> {
        await this.forceReleaseLock();
    }

    // Debug method to check lock status
    public async getLockStatus(): Promise<{
        exists: boolean;
        info?: LockInfo;
        age?: number;
        isStale?: boolean;
    }> {
        try {
            const lockData = await fs.readFile(this.lockFilePath, 'utf-8');
            const lockInfo: LockInfo = JSON.parse(lockData);
            const age = Date.now() - lockInfo.timestamp;

            return {
                exists: true,
                info: lockInfo,
                age,
                isStale: age > this.LOCK_TIMEOUT
            };
        } catch (error: any) {
            if (error.code === 'ENOENT') {
                return { exists: false };
            }
            throw error;
        }
    }
}