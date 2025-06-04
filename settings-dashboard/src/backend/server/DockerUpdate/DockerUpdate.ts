import {getConfig} from "@/configuration/getConfigBackend";
import {executeHostCommand} from "@/backend/cmd/HostExecutor";
import { JsonFileContext } from '../SimpleMutex';
import { DockerImageInfo, DockerUpdateStatus, ImageStatus, LastUpdateStatus } from './DockerUpdateTypes';

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
 * Run Docker update
 */
export async function dockerUpdate() {
    const composePath = getConfig("COMPOSE_FOLDER_PATH");
    const ctx = await getContext();

    try {
        console.log('Pulling latest images...');
        const pullResult = await executeHostCommand(
            `cd ${composePath} && docker compose pull`
        );

        // Create a script that will run the update commands
        const updateScript = `
            cd ${composePath} &&  
            docker compose up -d && 
            echo "Docker update completed successfully"
        `;

        console.log('Starting Docker update on host system...');

        // Execute the update on the host
        const logFile = '/tmp/docker_update.log';
        const result = await executeHostCommand(
            `nohup bash -c '${updateScript.replace(/'/g, "'\\''")}' > ${logFile} 2>&1 &`
        );

        console.log('Docker update command dispatched to host');
        console.log('Update will continue in background even if this container restarts');

        // Update status to show that update is no longer checking
        await ctx.update(data => ({
            ...data,
            isChecking: false,
            lastError: undefined,
            timestamp: new Date()
        }));

        return {
            status: 'initiated',
            message: 'Docker update started on host system',
            logPath: logFile
        };

    } catch (error) {
        console.error('Failed to initiate Docker update on host:', error);

        // Update status with error
        await ctx.update(data => ({
            ...data,
            isChecking: false,
            lastError: (error as Error).message,
            timestamp: new Date()
        }));

        // Fallback: try a simpler approach without nohup
        try {
            console.log('Attempting fallback update method...');

            const fallbackResult = await executeHostCommand(
                `cd ${composePath} && docker compose pull && docker compose up -d`,
                {
                    timeout: 120000 // 2 minutes timeout for fallback
                }
            );

            console.log('Fallback update completed:', fallbackResult.stdout);

            // Update status to show successful completion
            await ctx.update(data => ({
                ...data,
                isChecking: false,
                lastError: undefined,
                timestamp: new Date()
            }));

            return {
                status: 'completed',
                message: 'Docker update completed via fallback method',
                output: fallbackResult.stdout
            };

        } catch (fallbackError) {
            console.error('Fallback update also failed:', fallbackError);

            // Update status with final error
            await ctx.update(data => ({
                ...data,
                isChecking: false,
                lastError: `Docker update failed: ${(error as Error).message}. Fallback also failed: ${(fallbackError as Error).message}`,
                timestamp: new Date()
            }));

            throw new Error(`Docker update failed: ${(error as Error).message}. Fallback also failed: ${(fallbackError as Error).message}`);
        }
    }
}

/**
 * Check for updates
 */
export async function checkForUpdates(): Promise<ImageStatus[]> {
    const composePath = getConfig("COMPOSE_FOLDER_PATH");
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