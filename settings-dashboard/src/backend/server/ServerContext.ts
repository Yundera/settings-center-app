// lib/serverContext.ts
import { SelfCheckStatus } from "@/backend/server/SelfCheckTypes";

interface ServerContextData {
    selfCheckStatus: SelfCheckStatus;
    startTime: Date;
    stats: {
        requests: number;
        selfCheckRuns: number;
    };
    // Add other shared state as needed
}

class ServerContext {
    private data: Map<string, any> = new Map();
    private listeners: Map<string, Array<(value: any) => void>> = new Map();

    constructor() {
        // Initialize default data
        this.data.set('selfCheckStatus', {
            isRunning: false,
            overallStatus: 'never_run',
            scripts: {}
        } as SelfCheckStatus);

        this.data.set('stats', {
            requests: 0,
            selfCheckRuns: 0
        });

        this.data.set('startTime', new Date());
    }

    set<T>(key: string, value: T): void {
        this.data.set(key, value);

        // Notify listeners
        if (this.listeners.has(key)) {
            this.listeners.get(key)?.forEach(callback => callback(value));
        }
    }

    get<T>(key: string): T | undefined {
        return this.data.get(key);
    }

    update<T>(key: string, updater: (current: T) => T): void {
        const current = this.get<T>(key);
        if (current !== undefined) {
            this.set(key, updater(current));
        }
    }

    subscribe(key: string, callback: (value: any) => void): () => void {
        if (!this.listeners.has(key)) {
            this.listeners.set(key, []);
        }
        this.listeners.get(key)?.push(callback);

        // Return unsubscribe function
        return () => {
            const callbacks = this.listeners.get(key);
            if (callbacks) {
                const index = callbacks.indexOf(callback);
                if (index > -1) {
                    callbacks.splice(index, 1);
                }
            }
        };
    }

    // Specific helpers for self-check status
    getSelfCheckStatus(): SelfCheckStatus {
        const status = this.get<SelfCheckStatus>('selfCheckStatus');
        return status ? { ...status } : {
            isRunning: false,
            overallStatus: 'never_run',
            scripts: {}
        };
    }

    setSelfCheckStatus(status: SelfCheckStatus): void {
        this.set('selfCheckStatus', status);
    }

    updateSelfCheckStatus(updater: (current: SelfCheckStatus) => SelfCheckStatus): void {
        this.update('selfCheckStatus', updater);
    }

    // Stats helpers
    incrementStats(key: keyof ServerContextData['stats']): void {
        this.update('stats', (current: any) => ({
            ...current,
            [key]: (current[key] || 0) + 1
        }));
    }

    getStats() {
        return this.get('stats') || { requests: 0, selfCheckRuns: 0 };
    }
}

// Create singleton instance
const serverContext = global.serverContext || new ServerContext();
if (process.env.NODE_ENV === 'development') {
    global.serverContext = serverContext;
}

export default serverContext;