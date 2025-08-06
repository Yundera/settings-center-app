import {getConfig} from "@/configuration/getConfigBackend";
import {executeHostCommand} from "@/backend/cmd/HostExecutor";
import { JsonFileContext } from '../SimpleMutex';
import { DockerImageInfo, DockerUpdateStatus, ImageStatus, LastUpdateStatus } from './DockerUpdateTypes';

const composePath = getConfig("COMPOSE_FOLDER_PATH") || "/DATA/AppData/casaos/apps/yundera/";

// Default status
const DEFAULT_STATUS: DockerUpdateStatus = {
    timestamp: new Date(),
    images: [],
    totalImages: 0,
    hasUpdates: false,
    isChecking: false
};

// Global context instance
let context: JsonFileContext<DockerUpdateStatus> | null = null;

/**
 * Get or create the context
 */
export async function getContext(): Promise<JsonFileContext<DockerUpdateStatus>> {
    if (!context) {
        context = new JsonFileContext('docker-update-status', DEFAULT_STATUS);
        await context.initialize();
        console.log('DockerUpdate context initialized');
    }
    return context;
}


/**
 * Check for updates
 */
export async function checkForUpdates(): Promise<ImageStatus[]> {
    const cdCommand = `cd ${composePath}`;
    const ctx = await getContext();
    const startTime = Date.now();

    // Try to start the update check (atomic check and set)
    let canStart = false;
    await ctx.update(data => {
        if (data.isChecking) {
            return data; // Already checking
        }
        canStart = true;
        return {
            ...data,
            isChecking: true,
            timestamp: new Date(),
            lastError: undefined
        };
    });

    if (!canStart) {
        throw new Error('Docker update check is already running');
    }

    try {
        console.log('Starting Docker update check...');

        // Get list of current images
        const { stdout: localImages } = await executeHostCommand(
            `${cdCommand} && docker compose config --images`
        );

        const imageList = localImages.split('\n').filter(Boolean);
        const imageStatuses: ImageStatus[] = [];
        const imageInfos: DockerImageInfo[] = [];

        // Check each image for updates
        for (const image of imageList) {
            try {
                // Get currently running container's image digest
                let currentDigest = "local-not-found";
                try {
                    // Find container ID using the image name
                    const { stdout: containerIds } = await executeHostCommand(
                        `${cdCommand} && docker compose ps -q | xargs docker inspect -f '{{if eq .Config.Image "${image}"}}{{.Id}}{{end}}'`
                    );

                    // Get first non-empty container ID
                    const containerId = containerIds
                        .split('\n')
                        .map(line => line.trim())
                        .filter(line => line.length > 0)[0];

                    if (containerId) {
                        // Get image digest from the running container
                        const { stdout: containerImageId } = await executeHostCommand(
                            `docker inspect --format '{{.Image}}' ${containerId.trim()}`
                        );
                        currentDigest = containerImageId.trim();
                    }
                } catch (error) {
                    console.warn(`Warning: Couldn't get digest for running container of ${image}: ${(error as Error).message}`);
                }

                // Pull the latest image to get its digest
                await executeHostCommand(`docker pull ${image} --quiet`);
                const { stdout: latestDigest } = await executeHostCommand(
                    `docker image inspect ${image} --format '{{.Id}}'`
                );
                const availableDigest = latestDigest.trim();

                // Compare digests and create status
                const hasUpdate = currentDigest !== availableDigest;
                const imageStatus: ImageStatus = {
                    image,
                    currentDigest,
                    availableDigest,
                    hasUpdate,
                    status: hasUpdate ? 'update-available' : 'up-to-date'
                };

                imageStatuses.push(imageStatus);

                // Create image info for internal storage
                const imageInfo: DockerImageInfo = {
                    name: image,
                    currentTag: currentDigest,
                    latestTag: availableDigest,
                    hasUpdate,
                    lastChecked: new Date(),
                    digest: availableDigest
                };

                imageInfos.push(imageInfo);

            } catch (error) {
                console.error(`Error processing image ${image}: ${(error as Error).message}`);
                const errorStatus: ImageStatus = {
                    image,
                    currentDigest: "local-not-found",
                    availableDigest: "remote-not-found",
                    hasUpdate: false,
                    status: 'error',
                    error: (error as Error).message
                };

                imageStatuses.push(errorStatus);

                // Create error image info
                const imageInfo: DockerImageInfo = {
                    name: image,
                    currentTag: "local-not-found",
                    latestTag: "remote-not-found",
                    hasUpdate: false,
                    lastChecked: new Date()
                };

                imageInfos.push(imageInfo);
            }
        }

        const duration = Date.now() - startTime;
        const hasUpdates = imageInfos.some(img => img.hasUpdate);

        // Finalize the update check successfully
        await ctx.update(data => ({
            ...data,
            isChecking: false,
            images: imageInfos,
            totalImages: imageInfos.length,
            hasUpdates,
            checkDuration: duration,
            timestamp: new Date(),
            lastError: undefined
        }));

        console.log(`Docker update check completed in ${duration}ms`);
        console.log(`Found ${imageStatuses.filter(img => img.hasUpdate).length} images with updates out of ${imageStatuses.length} total`);

        return imageStatuses;

    } catch (error) {
        const duration = Date.now() - startTime;
        const errorMessage = (error as Error).message;

        // Finalize the update check with error
        await ctx.update(data => ({
            ...data,
            isChecking: false,
            checkDuration: duration,
            lastError: errorMessage,
            timestamp: new Date()
        }));

        console.error(`Docker update check failed after ${duration}ms: ${errorMessage}`);
        throw error;
    }
}

export async function getLastUpdateStatus(): Promise<LastUpdateStatus> {
    const ctx = await getContext();
    const status = await ctx.read();

    // Convert our format back to the old LastUpdateStatus format
    return {
        timestamp: status.timestamp,
        images: status.images.map(img => ({
            image: img.name,
            currentDigest: img.currentTag,
            availableDigest: img.latestTag || img.currentTag,
            hasUpdate: img.hasUpdate,
            status: img.hasUpdate ? 'update-available' : 'up-to-date'
        })),
        totalImages: status.totalImages,
        hasUpdates: status.hasUpdates,
        error: status.lastError
    };
}