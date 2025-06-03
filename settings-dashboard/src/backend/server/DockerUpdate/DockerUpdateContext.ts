import { FileMutexContext } from '../FileMutexContext';

export interface DockerImageInfo {
    name: string;
    currentTag: string;
    latestTag?: string;
    hasUpdate: boolean;
    lastChecked: Date;
    size?: number;
    digest?: string;
}

export interface DockerUpdateStatus {
    timestamp: Date;
    images: DockerImageInfo[];
    totalImages: number;
    hasUpdates: boolean;
    isChecking: boolean;
    lastError?: string;
    checkDuration?: number;
}

class DockerUpdateContext extends FileMutexContext<DockerUpdateStatus> {
    private static instance: DockerUpdateContext;

    protected defaultData: DockerUpdateStatus = {
        timestamp: new Date(),
        images: [],
        totalImages: 0,
        hasUpdates: false,
        isChecking: false
    };

    private constructor() {
        super('docker-update-context');
    }

    public static getInstance(): DockerUpdateContext {
        if (!DockerUpdateContext.instance) {
            DockerUpdateContext.instance = new DockerUpdateContext();
        }
        return DockerUpdateContext.instance;
    }

    // Validation
    protected validateData(data: any): DockerUpdateStatus {
        if (typeof data !== 'object' || data === null) {
            throw new Error('DockerUpdateStatus must be an object');
        }

        if (!data.timestamp) {
            throw new Error('timestamp is required');
        }

        if (!Array.isArray(data.images)) {
            throw new Error('images must be an array');
        }

        if (typeof data.totalImages !== 'number') {
            throw new Error('totalImages must be a number');
        }

        if (typeof data.hasUpdates !== 'boolean') {
            throw new Error('hasUpdates must be a boolean');
        }

        if (typeof data.isChecking !== 'boolean') {
            throw new Error('isChecking must be a boolean');
        }

        return data as DockerUpdateStatus;
    }

    // Serialization
    protected serializeData(data: DockerUpdateStatus): any {
        return {
            ...data,
            timestamp: data.timestamp.toISOString(),
            images: data.images.map(img => ({
                ...img,
                lastChecked: img.lastChecked.toISOString()
            }))
        };
    }

    // Deserialization
    protected deserializeData(data: any): DockerUpdateStatus {
        return {
            ...data,
            timestamp: new Date(data.timestamp),
            images: data.images.map((img: any) => ({
                ...img,
                lastChecked: new Date(img.lastChecked)
            }))
        };
    }

    // Docker update specific methods

    /**
     * Start a Docker update check
     * @returns true if check was started, false if already checking
     */
    public async startUpdateCheck(): Promise<boolean> {
        return this.withWriteLock(data => {
            if (data.isChecking) {
                return { data, result: false };
            }

            return {
                data: {
                    ...data,
                    isChecking: true,
                    timestamp: new Date(),
                    lastError: undefined
                },
                result: true
            };
        });
    }

    /**
     * Update a specific image's information
     */
    public async updateImageInfo(imageName: string, imageInfo: Omit<DockerImageInfo, 'name'>): Promise<void> {
        await this.withWriteLock(data => {
            const existingIndex = data.images.findIndex(img => img.name === imageName);
            const newImageInfo: DockerImageInfo = { name: imageName, ...imageInfo };

            let newImages: DockerImageInfo[];
            if (existingIndex >= 0) {
                newImages = [...data.images];
                newImages[existingIndex] = newImageInfo;
            } else {
                newImages = [...data.images, newImageInfo];
            }

            const hasUpdates = newImages.some(img => img.hasUpdate);

            return {
                data: {
                    ...data,
                    images: newImages,
                    totalImages: newImages.length,
                    hasUpdates,
                    timestamp: new Date()
                },
                result: undefined
            };
        });
    }

    /**
     * Finalize update check
     */
    public async finalizeUpdateCheck(checkDuration?: number, error?: string): Promise<void> {
        await this.withWriteLock(data => ({
            data: {
                ...data,
                isChecking: false,
                checkDuration,
                lastError: error,
                timestamp: new Date()
            },
            result: undefined
        }));
    }

    /**
     * Get images that have updates available
     */
    public async getImagesWithUpdates(): Promise<DockerImageInfo[]> {
        return this.withReadLock(data =>
            data.images.filter(img => img.hasUpdate).map(img => ({ ...img }))
        );
    }

    /**
     * Get specific image information
     */
    public async getImageInfo(imageName: string): Promise<DockerImageInfo | undefined> {
        return this.withReadLock(data => {
            const image = data.images.find(img => img.name === imageName);
            return image ? { ...image } : undefined;
        });
    }

    /**
     * Get all images
     */
    public async getAllImages(): Promise<DockerImageInfo[]> {
        return this.withReadLock(data => data.images.map(img => ({ ...img })));
    }

    /**
     * Check if currently checking for updates
     */
    public async isChecking(): Promise<boolean> {
        return this.withReadLock(data => data.isChecking);
    }

    /**
     * Get update summary
     */
    public async getUpdateSummary(): Promise<{
        totalImages: number;
        imagesWithUpdates: number;
        hasUpdates: boolean;
        isChecking: boolean;
        lastChecked: Date;
        lastError?: string;
        checkDuration?: number;
    }> {
        return this.withReadLock(data => ({
            totalImages: data.totalImages,
            imagesWithUpdates: data.images.filter(img => img.hasUpdate).length,
            hasUpdates: data.hasUpdates,
            isChecking: data.isChecking,
            lastChecked: new Date(data.timestamp),
            lastError: data.lastError,
            checkDuration: data.checkDuration
        }));
    }

    /**
     * Remove an image from tracking
     */
    public async removeImage(imageName: string): Promise<boolean> {
        return this.withWriteLock(data => {
            const initialLength = data.images.length;
            const newImages = data.images.filter(img => img.name !== imageName);

            if (newImages.length === initialLength) {
                return { data, result: false }; // Image not found
            }

            const hasUpdates = newImages.some(img => img.hasUpdate);

            return {
                data: {
                    ...data,
                    images: newImages,
                    totalImages: newImages.length,
                    hasUpdates,
                    timestamp: new Date()
                },
                result: true
            };
        });
    }

    /**
     * Clear all images
     */
    public async clearAllImages(): Promise<void> {
        await this.withWriteLock(data => ({
            data: {
                ...data,
                images: [],
                totalImages: 0,
                hasUpdates: false,
                timestamp: new Date()
            },
            result: undefined
        }));
    }

    /**
     * Update multiple images at once
     */
    public async updateMultipleImages(imageUpdates: DockerImageInfo[]): Promise<void> {
        await this.withWriteLock(data => {
            const imageMap = new Map(data.images.map(img => [img.name, img]));

            // Update existing images or add new ones
            imageUpdates.forEach(update => {
                imageMap.set(update.name, update);
            });

            const newImages = Array.from(imageMap.values());
            const hasUpdates = newImages.some(img => img.hasUpdate);

            return {
                data: {
                    ...data,
                    images: newImages,
                    totalImages: newImages.length,
                    hasUpdates,
                    timestamp: new Date()
                },
                result: undefined
            };
        });
    }

    /**
     * Get images older than specified date
     */
    public async getImagesOlderThan(date: Date): Promise<DockerImageInfo[]> {
        return this.withReadLock(data =>
            data.images
                .filter(img => img.lastChecked < date)
                .map(img => ({ ...img }))
        );
    }
}

export default DockerUpdateContext;