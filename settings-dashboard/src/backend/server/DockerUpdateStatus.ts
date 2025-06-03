
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
    images: ImageStatus[];  // Changed from updatesFound to images (all images)
    totalImages: number;
    hasUpdates: boolean;
    error?: string;
}