import {executeHostCommand, initializeSSHAccess, listAuthorizedKeys} from "@/backend/cmd/HostExecutor";

export async function start() {

    await initializeSSHAccess();

    await listAuthorizedKeys();

    try {
        const result = await executeHostCommand('ls -la /');
        console.log('Host directory listing:', result.stdout);
    } catch (e) {
        console.error('Error executing command:', e);
    }

}