// Track initialization state
import {getSelfCheckContext} from "@/backend/server/SelfCheck/SelfCheck";
import {getDockerUpdateContext} from "@/backend/server/DockerUpdate/DockerUpdate";

let contextsInitialized = false;
let initializationPromise: Promise<void> | null = null;

export async function initializeAllContexts(): Promise<void> {
    if (contextsInitialized) {
        return;
    }

    if (initializationPromise) {
        await initializationPromise;
        return;
    }

    initializationPromise = (async () => {
        try {
            console.log('=== Initializing Application Contexts ===');

            // Initialize SelfCheck context first (since it may fix file system issues)
            console.log('Initializing SelfCheck context...');
            const selfCheckContext = await getSelfCheckContext();
            // Context initialization happens in getSelfCheckContext via getInternalContext()
            console.log('✓ SelfCheck context ready');

            // Small delay to avoid lock contention
            await new Promise(resolve => setTimeout(resolve, 100));

            // Initialize Docker context second
            console.log('Initializing DockerUpdate context...');
            const dockerContext = await getDockerUpdateContext();
            // Context initialization happens in getDockerUpdateContext via getInternalContext()
            console.log('✓ DockerUpdate context ready');

            contextsInitialized = true;
            console.log('=== All Contexts Initialized Successfully ===');

        } catch (error) {
            console.error('Failed to initialize contexts:', error);
            // Reset state so initialization can be retried
            contextsInitialized = false;
            initializationPromise = null;
            throw error;
        }
    })();

    await initializationPromise;
}