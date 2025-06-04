import fs from 'fs/promises';
import path from 'path';

/**
 * Simple file-based mutex for JSON data
 * No complex queuing, just basic lock/unlock with file operations
 */
export class SimpleMutex {
    private lockFile: string;
    private isLocked: boolean = false;
    private lockTimeout: number = 5000; // 5 second timeout

    constructor(private filePath: string) {
        this.lockFile = `${filePath}.lock`;
    }

    /**
     * Acquire lock - simple polling approach
     */
    async acquire(): Promise<void> {
        const startTime = Date.now();

        while (this.isLocked || await this.isLockedByFile()) {
            if (Date.now() - startTime > this.lockTimeout) {
                throw new Error(`Lock timeout after ${this.lockTimeout}ms for ${this.filePath}`);
            }
            await new Promise(resolve => setTimeout(resolve, 10)); // Short wait
        }

        this.isLocked = true;
        await this.createLockFile();
    }

    /**
     * Release lock
     */
    async release(): Promise<void> {
        if (!this.isLocked) {
            return;
        }

        this.isLocked = false;
        await this.removeLockFile();
    }

    /**
     * Execute function with lock
     */
    async withLock<T>(fn: () => Promise<T>): Promise<T> {
        await this.acquire();
        try {
            return await fn();
        } finally {
            await this.release();
        }
    }

    private async isLockedByFile(): Promise<boolean> {
        try {
            await fs.access(this.lockFile);
            return true;
        } catch {
            return false;
        }
    }

    private async createLockFile(): Promise<void> {
        try {
            await fs.writeFile(this.lockFile, Date.now().toString());
        } catch (error) {
            console.error(`Failed to create lock file ${this.lockFile}:`, error);
        }
    }

    private async removeLockFile(): Promise<void> {
        try {
            await fs.unlink(this.lockFile);
        } catch (error) {
            // Lock file might not exist, ignore error
        }
    }
}

/**
 * Simple JSON file context with mutex
 */
export class JsonFileContext<T> {
    private mutex: SimpleMutex;

    constructor(
        private fileName: string,
        private defaultData: T,
        private baseDir: string = process.cwd()
    ) {
        const filePath = path.join(baseDir, `${fileName}.json`);
        this.mutex = new SimpleMutex(filePath);
    }

    private get filePath(): string {
        return path.join(this.baseDir, `${this.fileName}.json`);
    }

    /**
     * Initialize - ensure file exists with default data
     */
    async initialize(): Promise<void> {
        await this.mutex.withLock(async () => {
            try {
                await fs.access(this.filePath);
                // File exists, validate it by reading
                await this.readFile();
            } catch {
                // File doesn't exist, create with defaults
                await this.writeFile(this.defaultData);
            }
        });
    }

    /**
     * Read data (with lock)
     */
    async read(): Promise<T> {
        return this.mutex.withLock(async () => {
            return await this.readFile();
        });
    }

    /**
     * Write data (with lock)
     */
    async write(data: T): Promise<void> {
        await this.mutex.withLock(async () => {
            await this.writeFile(data);
        });
    }

    /**
     * Update data (with lock)
     */
    async update(updateFn: (data: T) => T): Promise<void> {
        await this.mutex.withLock(async () => {
            const currentData = await this.readFile();
            const newData = updateFn({ ...currentData } as T);
            await this.writeFile(newData);
        });
    }

    private async readFile(): Promise<T> {
        try {
            const content = await fs.readFile(this.filePath, 'utf-8');
            const parsed = JSON.parse(content);
            return this.deserializeData(parsed);
        } catch (error) {
            console.warn(`Failed to read ${this.filePath}, using defaults:`, (error as Error).message);
            return { ...this.defaultData };
        }
    }

    private async writeFile(data: T): Promise<void> {
        try {
            const serialized = this.serializeData(data);
            const content = JSON.stringify(serialized, null, 2);

            // Atomic write using temp file
            const tempFile = `${this.filePath}.tmp`;
            await fs.writeFile(tempFile, content, 'utf-8');
            await fs.rename(tempFile, this.filePath);
        } catch (error) {
            console.error(`Failed to write ${this.filePath}:`, error);
            throw error;
        }
    }

    /**
     * Override in subclass if custom serialization needed
     */
    protected serializeData(data: T): any {
        return this.defaultSerialize(data);
    }

    /**
     * Override in subclass if custom deserialization needed
     */
    protected deserializeData(data: any): T {
        return this.defaultDeserialize(data);
    }

    private defaultSerialize(data: any): any {
        if (data && typeof data === 'object') {
            const result: any = Array.isArray(data) ? [] : {};

            for (const [key, value] of Object.entries(data)) {
                if (value instanceof Date) {
                    result[key] = value.toISOString();
                } else if (value && typeof value === 'object') {
                    result[key] = this.defaultSerialize(value);
                } else {
                    result[key] = value;
                }
            }
            return result;
        }
        return data;
    }

    private defaultDeserialize(data: any): any {
        if (data && typeof data === 'object') {
            const result: any = Array.isArray(data) ? [] : {};

            for (const [key, value] of Object.entries(data)) {
                if (typeof value === 'string' && this.isISODate(value)) {
                    result[key] = new Date(value);
                } else if (value && typeof value === 'object') {
                    result[key] = this.defaultDeserialize(value);
                } else {
                    result[key] = value;
                }
            }
            return result;
        }
        return data;
    }

    private isISODate(str: string): boolean {
        return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(str);
    }

    /**
     * Cleanup
     */
    async cleanup(): Promise<void> {
        await this.mutex.release();
    }
}