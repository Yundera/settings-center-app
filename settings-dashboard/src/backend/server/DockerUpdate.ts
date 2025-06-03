import {getConfig} from "@/configuration/getConfigBackend";
import {executeHostCommand} from "@/backend/cmd/HostExecutor";
import {ImageStatus, LastUpdateStatus} from "@/backend/server/DockerUpdateStatus";
import SharedContext from "./SharedContext";

export async function dockerUpdate() {
    const composePath = getConfig("COMPOSE_FOLDER_PATH");

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

        return {
            status: 'initiated',
            message: 'Docker update started on host system',
            logPath: logFile
        };

    } catch (error) {
        console.error('Failed to initiate Docker update on host:', error);

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

            return {
                status: 'completed',
                message: 'Docker update completed via fallback method',
                output: fallbackResult.stdout
            };

        } catch (fallbackError) {
            console.error('Fallback update also failed:', fallbackError);
            throw new Error(`Docker update failed: ${error.message}. Fallback also failed: ${fallbackError.message}`);
        }
    }
}

export async function checkForUpdates(): Promise<ImageStatus[]> {
    const composePath = getConfig("COMPOSE_FOLDER_PATH");
    const cdCommand = `cd ${composePath}`;
    const sharedContext = SharedContext.getInstance();

    try {
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
                    console.warn(`Warning: Couldn't get digest for running container of ${image}: ${error.message}`);
                }

                // Pull the latest image to get its digest
                await executeHostCommand(`docker pull ${image} --quiet`);
                const { stdout: latestDigest } = await executeHostCommand(
                    `docker image inspect ${image} --format '{{.Id}}'`
                );
                const availableDigest = latestDigest.trim();

                // Compare digests and create status
                const hasUpdate = currentDigest !== availableDigest;
                imageStatuses.push({
                    image,
                    currentDigest,
                    availableDigest,
                    hasUpdate,
                    status: hasUpdate ? 'update-available' : 'up-to-date'
                });

            } catch (error) {
                console.error(`Error processing image ${image}: ${error.message}`);
                imageStatuses.push({
                    image,
                    currentDigest: "local-not-found",
                    availableDigest: "remote-not-found",
                    hasUpdate: false,
                    status: 'error',
                    error: error.message
                });
            }
        }

        // Store the status of this check in shared context
        const lastUpdateStatus: LastUpdateStatus = {
            timestamp: new Date(),
            images: imageStatuses,
            totalImages: imageList.length,
            hasUpdates: imageStatuses.some(img => img.hasUpdate)
        };

        await sharedContext.setLastUpdateStatus(lastUpdateStatus);

        return imageStatuses;
    } catch (error) {
        // Store error status in shared context
        const errorStatus: LastUpdateStatus = {
            timestamp: new Date(),
            images: [],
            totalImages: 0,
            hasUpdates: false,
            error: error.message
        };

        await sharedContext.setLastUpdateStatus(errorStatus);

        throw error;
    }
}

export function getLastUpdateStatus(): LastUpdateStatus {
    const sharedContext = SharedContext.getInstance();
    return sharedContext.getLastUpdateStatusSync();
}

// Async version for when you can use await
export async function getLastUpdateStatusAsync(): Promise<LastUpdateStatus> {
    const sharedContext = SharedContext.getInstance();
    return await sharedContext.getLastUpdateStatus();
}