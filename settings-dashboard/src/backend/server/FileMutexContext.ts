import fs from 'fs/promises';
import path from 'path';

interface LockInfo {
    pid: number;
    timestamp: number;
    hostname?: string;
}

export abstract class FileMutexContext<T> {
    protected dataFilePath: string;
    protected lockFilePath: string;
    protected cache: T | null = null;
    protected lastFileModTime: number = 0;
    protected abstract defaultData: T;

    // Lock configuration
    private readonly LOCK_TIMEOUT = 30000; // 30 seconds
    private readonly RETRY_DELAY = 100; // 100ms
    private readonly MAX_RETRIES = 300; // 30 seconds total

    constructor(fileName: string, baseDir: string = process.cwd()) {
        this.dataFilePath = path.join(baseDir, `${fileName}.json`);
        this.lockFilePath = path.join(baseDir, `${fileName}.lock`);
    }

    // Abstract methods that subclasses must implement
    protected abstract validateData(data: any): T;
    protected abstract serializeData(data: T): any;
    protected abstract deserializeData(data: any): T;

    // File-based mutex implementation
    private async acquireLock(): Promise<() => Promise<void>> {
        const lockInfo: LockInfo = {
            pid: process.pid,
            timestamp: Date.now(),
            hostname: process.env.HOSTNAME || 'unknown'
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
                return async () => this.releaseLock();

            } catch (error: any) {
                if (error.code === 'EEXIST') {
                    // Lock file exists, check if it's stale
                    try {
                        const existingLockData = await fs.readFile(this.lockFilePath, 'utf-8');
                        const existingLock: LockInfo = JSON.parse(existingLockData);

                        // Check if lock is stale (older than timeout)
                        if (Date.now() - existingLock.timestamp > this.LOCK_TIMEOUT) {
                            console.warn(`Removing stale lock from PID ${existingLock.pid} (${Date.now() - existingLock.timestamp}ms old)`);
                            await this.forceReleaseLock();
                            // Try again immediately
                            continue;
                        }

                        // Lock is active, wait and retry
                        await this.sleep(this.RETRY_DELAY);
                        retries++;

                    } catch (parseError) {
                        // Corrupted lock file, remove it
                        console.warn('Removing corrupted lock file');
                        await this.forceReleaseLock();
                        continue;
                    }
                } else {
                    throw error;
                }
            }
        }

        throw new Error(`Failed to acquire lock after ${this.MAX_RETRIES} retries (${this.MAX_RETRIES * this.RETRY_DELAY}ms)`);
    }

    private async releaseLock(): Promise<void> {
        try {
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

    // File operations
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
            const tempFile = `${this.dataFilePath}.tmp`;
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
}