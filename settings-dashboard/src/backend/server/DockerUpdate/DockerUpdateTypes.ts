// Types
export interface ImageStatus {
    image: string;
    currentDigest: string;
    availableDigest: string;
    hasUpdate: boolean;
    status: 'up-to-date' | 'update-available' | 'error';
    error?: string;
}

export interface LastUpdateStatus {
    timestamp: Date;
    images: ImageStatus[];
    totalImages: number;
    hasUpdates: boolean;
    error?: string;
}

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
