import {
    initializeSSHAccess,
    listAuthorizedKeys,
} from "@/backend/cmd/HostExecutor";
import { startHealthRefresh } from "@/backend/server/Health/Health";
import { startMetricsRefresh } from "@/backend/server/Metrics/Metrics";

export async function start() {
    await initializeSSHAccess();
    await listAuthorizedKeys();
    startHealthRefresh();
    startMetricsRefresh();
}
