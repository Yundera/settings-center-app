import { getContext as getSelfCheckContext } from './SelfCheck/SelfCheck';
import {getContext as getDockerUpdateContext} from './DockerUpdate/DockerUpdate';

let contextsInitialized = false;

export async function initializeAllContexts(): Promise<void> {
    if (contextsInitialized) {
        return;
    }

    try {
        // Initialize SelfCheck context
        await getSelfCheckContext();

        // Initialize DockerUpdate context
        await getDockerUpdateContext();

        contextsInitialized = true;
        console.log('=== All Contexts Initialized Successfully ===');

    } catch (error) {
        console.error('Failed to initialize contexts:', error);
        // Don't set contextsInitialized to true so it can be retried
        throw error;
    }
}