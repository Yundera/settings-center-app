export interface UpdateInfo {
    image: string;
    currentDigest: string;
    availableDigest: string;
}

export interface LastUpdateStatus {
    timestamp: Date;
    updatesFound: UpdateInfo[];
    totalImages: number;
    hasUpdates: boolean;
    error?: string;
}