import fs from 'fs/promises';
import path from 'path';
import { LastUpdateStatus } from './DockerUpdateStatus';

interface SharedContextData {
    lastUpdateStatus: LastUpdateStatus;
    // Add other shared state here as needed
}

class SharedContext {
    private static instance: SharedContext;
    private contextFilePath: string;
    private cache: SharedContextData | null = null;
    private defaultData: SharedContextData;

    private constructor() {
        // Store context in a temporary directory that persists across container restarts
        this.contextFilePath = path.join(process.cwd(), '.shared-context.json');
        this.defaultData = {
            lastUpdateStatus: {
                timestamp: new Date(),
                images: [],
                totalImages: 0,
                hasUpdates: false
            }
        };
    }

    public static getInstance(): SharedContext {
        if (!SharedContext.instance) {
            SharedContext.instance = new SharedContext();
        }
        return SharedContext.instance;
    }

    private async ensureFileExists(): Promise<void> {
        try {
            await fs.access(this.contextFilePath);
        } catch {
            // File doesn't exist, create it with default data
            await this.writeToFile(this.defaultData);
        }
    }

    private async readFromFile(): Promise<SharedContextData> {
        try {
            await this.ensureFileExists();
            const data = await fs.readFile(this.contextFilePath, 'utf-8');
            const parsed = JSON.parse(data);

            // Convert timestamp back to Date object
            if (parsed.lastUpdateStatus && parsed.lastUpdateStatus.timestamp) {
                parsed.lastUpdateStatus.timestamp = new Date(parsed.lastUpdateStatus.timestamp);
            }

            return parsed;
        } catch (error) {
            console.warn('Failed to read shared context, using defaults:', error.message);
            return this.defaultData;
        }
    }

    private async writeToFile(data: SharedContextData): Promise<void> {
        try {
            await fs.writeFile(this.contextFilePath, JSON.stringify(data, null, 2), 'utf-8');
            this.cache = data;
        } catch (error) {
            console.error('Failed to write shared context:', error.message);
        }
    }

    private async getData(): Promise<SharedContextData> {
        if (!this.cache) {
            this.cache = await this.readFromFile();
        }
        return this.cache;
    }

    public async getLastUpdateStatus(): Promise<LastUpdateStatus> {
        const data = await this.getData();
        return data.lastUpdateStatus;
    }

    public async setLastUpdateStatus(status: LastUpdateStatus): Promise<void> {
        const data = await this.getData();
        data.lastUpdateStatus = status;
        await this.writeToFile(data);
    }

    // Method to get status synchronously (for backward compatibility)
    public getLastUpdateStatusSync(): LastUpdateStatus {
        if (this.cache) {
            return this.cache.lastUpdateStatus;
        }
        // Return default if cache is not available
        return this.defaultData.lastUpdateStatus;
    }

    // Initialize the context (call this during server startup)
    public async initialize(): Promise<void> {
        this.cache = await this.readFromFile();
        console.log('Shared context initialized');
    }
}

export default SharedContext;