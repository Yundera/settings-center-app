import {
    executeHostCommand,
    initializeSSHAccess,
    listAuthorizedKeys,
    waitForSSHConnection
} from "@/backend/cmd/HostExecutor";
import cron from 'node-cron';
import {checkForUpdates, dockerUpdate} from "@/backend/server/DockerUpdate";
import { runSelfCheck} from "@/backend/server/SelfCheck";

async function check(){
    try {
        console.log(`Update at ${new Date().toISOString()}`);
        //- run self check
        await runSelfCheck();

        let updateInfos = await checkForUpdates();
        if (updateInfos.length > 0) {
            console.log('Updates available:', updateInfos);
            await dockerUpdate();
            ///////////////////////////////////////////////////////
            // WARNING: don't add code after the update command
            // update may restart this container - don't remove this comment
            ///////////////////////////////////////////////////////
        }
    }catch (e) {
        //check should never fail
        console.error(e);
    }
}

export async function start() {

    await initializeSSHAccess();

    await listAuthorizedKeys();

    await check();

    // Runs at 3:00 AM every day
    cron.schedule('0 3 * * *', async ()=> {
        await check();
    });
}