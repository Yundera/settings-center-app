import {getConfig} from "@/configuration/getConfigBackend";
import {executeHostCommand} from "@/backend/cmd/HostExecutor";
import {ImageStatus, LastUpdateStatus} from "@/backend/server/DockerUpdate/DockerUpdateStatus";
import DockerUpdateContext, { DockerImageInfo } from "./DockerUpdateContext";

// Internal context instance - not exposed to external APIs
let internalContext: DockerUpdateContext | null = null;
let initializationPromise: Promise<DockerUpdateContext> | null = null;

async function getInternalContext(): Promise<DockerUpdateContext> {
    if (internalContext) {
        return internalContext;
    }

    if (initializationPromise) {
        return await initializationPromise;
    }

    initializationPromise = (async () => {
        try {
            console.log('Initializing DockerUpdateContext...');
            const context = DockerUpdateContext.getInstance();
            await context.initialize();
            internalContext = context;
            console.log('DockerUpdateContext initialized');
            return context;
        } catch (error) {
            // Reset promise so initialization can be retried
            initializationPromise = null;
            console.error('Failed to initialize DockerUpdateContext:', error);
            throw error;
        }
    })();

    return await initializationPromise;
}

// ===== EXISTING PUBLIC API - NO CHANGES REQUIRED BY API LAYER =====

export async function dockerUpdate() {
    const composePath = getConfig("COMPOSE_FOLDER_PATH");
    const context = await getInternalContext();

    try {
        console.log('Pulling latest images...');
        const pullResult = await executeHostCommand(
            `cd ${composePath} && docker compose pull`
        );

        // Since this container might be updated/killed during the process,
        // we'll execute the commands in a way that doesn't require our process to stay alive

        // Create a script that will run the update commands
        const updateScript = `
            cd ${composePath} &&  
            docker compose up -d && 
            echo "Docker update completed successfully"
        `;

        console.log('Starting Docker update on host system...');

        // Execute the update on the host
        // Note: This might kill our own container, so we use a fire-and-forget approach
        const logFile = '/tmp/docker_update.log';
        const result = await executeHostCommand(
            `nohup bash -c '${updateScript.replace(/'/g, "'\\''")}' > ${logFile} 2>&1 &`
        );

        console.log('Docker update command dispatched to host');
        console.log('Update will continue in background even if this container restarts');

        // Update the internal context to show that update is no longer checking
        await context.finalizeUpdateCheck(undefined, undefined);

        return {
            status: 'initiated',
            message: 'Docker update started on host system',
            logPath: logFile
        };

    } catch (error) {
        console.error('Failed to initiate Docker update on host:', error);

        // Update internal context with error
        await context.finalizeUpdateCheck(undefined, (error as Error).message);

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

            // Update internal context to show successful completion
            await context.finalizeUpdateCheck(undefined, undefined);

            return {
                status: 'completed',
                message: 'Docker update completed via fallback method',
                output: fallbackResult.stdout
            };

        } catch (fallbackError) {
            console.error('Fallback update also failed:', fallbackError);

            // Update internal context with final error
            await context.finalizeUpdateCheck(
                undefined,
                `Docker update failed: ${(error as Error).message}. Fallback also failed: ${(fallbackError as Error).message}`
            );

            throw new Error(`Docker update failed: ${(error as Error).message}. Fallback also failed: ${(fallbackError as Error).message}`);
        }
    }
}

export async function checkForUpdates(): Promise<ImageStatus[]> {
    const composePath = getConfig("COMPOSE_FOLDER_PATH");
    const cdCommand = `cd ${composePath}`;
    const context = await getInternalContext();
    const startTime = Date.now();

    // Try to start the update check atomically using internal context
    const wasAbleToStart = await context.startUpdateCheck();
    if (!wasAbleToStart) {
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

                // Update the internal context with this image's information
                await context.updateImageInfo(image, {
                    currentTag: currentDigest,
                    latestTag: availableDigest,
                    hasUpdate,
                    lastChecked: new Date(),
                    digest: availableDigest
                });

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

                // Update internal context with error for this image
                await context.updateImageInfo(image, {
                    currentTag: "local-not-found",
                    latestTag: "remote-not-found",
                    hasUpdate: false,
                    lastChecked: new Date()
                });
            }
        }

        const duration = Date.now() - startTime;

        // Finalize the update check successfully using internal context
        await context.finalizeUpdateCheck(duration, undefined);

        console.log(`Docker update check completed in ${duration}ms`);
        console.log(`Found ${imageStatuses.filter(img => img.hasUpdate).length} images with updates out of ${imageStatuses.length} total`);

        return imageStatuses;

    } catch (error) {
        const duration = Date.now() - startTime;
        const errorMessage = (error as Error).message;

        // Finalize the update check with error using internal context
        await context.finalizeUpdateCheck(duration, errorMessage);

        console.error(`Docker update check failed after ${duration}ms: ${errorMessage}`);
        throw error;
    }
}

// ===== BACKWARD COMPATIBILITY FUNCTIONS - UNCHANGED API =====

export function getLastUpdateStatus(): LastUpdateStatus {
    // Try to get from internal context first, fallback to default
    if (internalContext) {
        const dockerStatus = internalContext.getDataSync();

        // Convert our new format back to the old LastUpdateStatus format
        return {
            timestamp: dockerStatus.timestamp,
            images: dockerStatus.images.map(img => ({
                image: img.name,
                currentDigest: img.currentTag,
                availableDigest: img.latestTag || img.currentTag,
                hasUpdate: img.hasUpdate,
                status: img.hasUpdate ? 'update-available' : 'up-to-date'
            })),
            totalImages: dockerStatus.totalImages,
            hasUpdates: dockerStatus.hasUpdates,
            error: dockerStatus.lastError
        };
    }

    // Return default status if context not initialized yet
    return {
        timestamp: new Date(),
        images: [],
        totalImages: 0,
        hasUpdates: false
    };
}

// Async version for when you can use await
export async function getLastUpdateStatusAsync(): Promise<LastUpdateStatus> {
    const context = await getInternalContext();
    const dockerStatus = await context.getData();

    // Convert our new format back to the old LastUpdateStatus format
    return {
        timestamp: dockerStatus.timestamp,
        images: dockerStatus.images.map(img => ({
            image: img.name,
            currentDigest: img.currentTag,
            availableDigest: img.latestTag || img.currentTag,
            hasUpdate: img.hasUpdate,
            status: img.hasUpdate ? 'update-available' : 'up-to-date'
        })),
        totalImages: dockerStatus.totalImages,
        hasUpdates: dockerStatus.hasUpdates,
        error: dockerStatus.lastError
    };
}

// ===== CLEANUP AND UTILITIES =====

// Optional: Export for manual cleanup if needed
export async function cleanupDockerUpdateContext(): Promise<void> {
    if (internalContext) {
        await internalContext.cleanup();
        internalContext = null;
        initializationPromise = null;
    }
}

// Optional: Get context instance for advanced operations (internal use)
export async function getDockerUpdateContext(): Promise<DockerUpdateContext> {
    return await getInternalContext();
}

// Optional: Get update summary (new functionality)
export async function getDockerUpdateSummary(): Promise<{
    totalImages: number;
    imagesWithUpdates: number;
    hasUpdates: boolean;
    isChecking: boolean;
    lastChecked: Date;
    lastError?: string;
    checkDuration?: number;
}> {
    const context = await getInternalContext();
    return await context.getUpdateSummary();
}

// Optional: Get images with updates (new functionality)
export async function getImagesWithUpdates(): Promise<DockerImageInfo[]> {
    const context = await getInternalContext();
    return await context.getImagesWithUpdates();
}

// Optional: Check if currently checking for updates (new functionality)
export async function isCheckingForUpdates(): Promise<boolean> {
    const context = await getInternalContext();
    return await context.isChecking();
}