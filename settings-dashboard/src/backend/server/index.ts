import {
    initializeSSHAccess,
    listAuthorizedKeys,
} from "@/backend/cmd/HostExecutor";
import { startHealthRefresh } from "@/backend/server/Health/Health";

export async function start() {
    await initializeSSHAccess();
    await listAuthorizedKeys();
    startHealthRefresh();
}
