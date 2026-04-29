import {
    initializeSSHAccess,
    listAuthorizedKeys,
} from "@/backend/cmd/HostExecutor";

export async function start() {
    await initializeSSHAccess();
    await listAuthorizedKeys();
}
