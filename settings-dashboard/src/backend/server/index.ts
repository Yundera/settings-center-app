import {
    executeHostCommand,
    initializeSSHAccess,
    listAuthorizedKeys,
    waitForSSHConnection
} from "@/backend/cmd/HostExecutor";
import cron from 'node-cron';
import {checkForUpdates} from "@/backend/server/DockerUpdate/DockerUpdate";
import { runSelfCheck} from "@/backend/server/SelfCheck/SelfCheck";

async function check(){
    try {
        console.log(`Update at ${new Date().toISOString()}`);
        //- run self check
        await runSelfCheck();

        // Check for updates (for status display only - no automatic updates)
        let updateInfos = await checkForUpdates();
        if (updateInfos.length > 0) {
            console.log('Updates available:', updateInfos);
            // Note: Automatic updates have been disabled
        }
    }catch (e) {
        //check should never fail
        console.error(e);
    }
}

export async function start() {
    await initializeSSHAccess();

    await listAuthorizedKeys();

    setTimeout(() => {
        cron.schedule('0 3 * * *', async () => {
            await check();
        });
    }, 60*60*1000);//60 minutes after start
}