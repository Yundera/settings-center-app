import {getConfig} from "@/configuration/getConfigBackend";
import {executeHostCommand} from "@/backend/cmd/HostExecutor";
import {spawn} from 'child_process';
import {ImageStatus, LastUpdateStatus} from "@/backend/server/DockerUpdateStatus";

// In-memory storage for last update status
let lastUpdateStatus: LastUpdateStatus = {
    timestamp: new Date(),
    images: [],
    totalImages: 0,
    hasUpdates: false
}

export async function dockerUpdate() {
    const composePath = getConfig("COMPOSE_FOLDER_PATH");

    // Run docker commands in detached process
    const child = spawn('bash', ['-c', `cd ${composePath} && docker compose pull && docker compose up -d`], {
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe']
    });

    // Log the process ID for tracking
    console.log(`Docker update started in detached process: PID ${child.pid}`);

    // Optionally capture output before detaching
    child.stdout?.on('data', (data) => {
        console.log(`Docker update: ${data}`);
    });

    child.stderr?.on('data', (data) => {
        console.error(`Docker update error: ${data}`);
    });

    child.unref(); // Allow parent to exit

    return { pid: child.pid, detached: true };
}

export async function checkForUpdates(): Promise<ImageStatus[]> {
    const composePath = getConfig("COMPOSE_FOLDER_PATH");
    const cdCommand = `cd ${composePath}`;

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

        // Store the status of this check
        lastUpdateStatus = {
            timestamp: new Date(),
            images: imageStatuses,
            totalImages: imageList.length,
            hasUpdates: imageStatuses.some(img => img.hasUpdate)
        };

        return imageStatuses;
    } catch (error) {
        // Store error status
        lastUpdateStatus = {
            timestamp: new Date(),
            images: [],
            totalImages: 0,
            hasUpdates: false,
            error: error.message
        };

        throw error;
    }
}

export function getLastUpdateStatus(): LastUpdateStatus {
    return lastUpdateStatus;
}

// Backward compatibility - return only images with updates
export function getUpdatesFound(): ImageStatus[] {
    return lastUpdateStatus.images.filter(img => img.hasUpdate);
}