import {executeHostCommand} from "@/backend/cmd/HostExecutor";
import * as path from 'path';
import {getConfig} from "@/configuration/getConfigBackend";
import { JsonFileContext } from '../SimpleMutex';
import {SelfCheckResult, SelfCheckStatus} from "./SelfCheckTypes";

// Constants
const REMOTE_DATA_APP = getConfig("COMPOSE_FOLDER_PATH") || "/DATA/AppData/casaos/apps/yundera/";
const REMOTE_SCRIPT_DIR = `${REMOTE_DATA_APP}/scripts`;

//order of scripts matters, as some depend on others
const SELF_CHECK_SCRIPTS = [
    'ensure-pcs-user.sh',
    'ensure-script-executable.sh',
    'ensure-template-sync.sh',
    'ensure-ubuntu-up-to-date.sh',
    'ensure-common-tools-installed.sh',
    'ensure-ssh.sh',
    'ensure-vm-scalable.sh',
    'ensure-qemu-agent.sh',
    'ensure-data-partition.sh',
    'ensure-data-partition-size.sh',
    'ensure-swap.sh',
    'ensure-self-check-at-reboot.sh',
    'ensure-docker-installed.sh',
    'ensure-user-docker-compose-updated.sh',
    'ensure-user-compose-pulled.sh',
    'ensure-user-compose-stack-up.sh'
];

// Default status
const DEFAULT_STATUS: SelfCheckStatus = {
    isRunning: false,
    overallStatus: 'never_run',
    scripts: {}
};

// Global context instance
let context: JsonFileContext<SelfCheckStatus> | null = null;

/**
 * Get or create the context
 */
export async function getContext(): Promise<JsonFileContext<SelfCheckStatus>> {
    if (!context) {
        context = new JsonFileContext('selfcheck-status', DEFAULT_STATUS);
        await context.initialize();
    }
    return context;
}

/**
 * Get self-check status (asynchronous, fresh read)
 */
export async function getSelfCheckStatus(): Promise<SelfCheckStatus> {
    const ctx = await getContext();
    return await ctx.read();
}

/**
 * Run self-check
 */
export async function runSelfCheck(): Promise<void> {
    const ctx = await getContext();

    // Try to start self-check (atomic check and set)
    let canStart = false;
    await ctx.update(data => {
        if (data.isRunning) {
            return data; // Already running
        }
        canStart = true;
        return {
            ...data,
            isRunning: true,
            lastRun: new Date(),
            overallStatus: 'never_run',
            scripts: {}
        };
    });

    if (!canStart) {
        throw new Error('Self-check is already running');
    }

    let successCount = 0;
    const totalCount = SELF_CHECK_SCRIPTS.length;

    try {
        // Run all self-check scripts
        for (const scriptName of SELF_CHECK_SCRIPTS) {
            await runScript(ctx, scriptName);

            // Check if script succeeded
            const currentStatus = await ctx.read();
            if (currentStatus.scripts[scriptName]?.success) {
                successCount++;
            }
        }

        // Determine overall status
        let overallStatus: 'success' | 'failure' | 'partial';
        if (successCount === totalCount) {
            overallStatus = 'success';
        } else if (successCount === 0) {
            overallStatus = 'failure';
        } else {
            overallStatus = 'partial';
        }

        // Finalize
        await ctx.update(data => ({
            ...data,
            isRunning: false,
            overallStatus
        }));

        console.log(`Self-check completed: ${successCount}/${totalCount} scripts succeeded`);
        console.log(`Overall status: ${overallStatus}`);

    } catch (error) {
        // Ensure we clear the running state
        await ctx.update(data => ({
            ...data,
            isRunning: false,
            overallStatus: 'failure'
        }));
        throw error;
    }
}


async function runScript(ctx: JsonFileContext<SelfCheckStatus>, scriptName: string, timeoutMs: number = 1200000): Promise<void> {
    const wrapperPath = path.join(REMOTE_SCRIPT_DIR,'tools','execute_script_with_log.sh');
    const targetScriptPath = path.join(REMOTE_SCRIPT_DIR, 'self-check', scriptName);
    const startTime = Date.now();

    try {
        console.log(`Running: ${scriptName}`);

        // Create a timeout promise
        const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => {
                reject(new Error(`Script timed out after ${timeoutMs}ms`));
            }, timeoutMs);
        });

        // Race between the script execution and timeout
        await Promise.race([
            executeHostCommand(`${wrapperPath} ${targetScriptPath}`),
            timeoutPromise
        ]);

        const duration = Date.now() - startTime;

        // Update script result
        const scriptResult: SelfCheckResult = {
            success: true,
            message: `Script completed successfully`,
            timestamp: new Date(),
            duration
        };

        await ctx.update(data => ({
            ...data,
            scripts: {
                ...data.scripts,
                [scriptName]: scriptResult
            }
        }));

        console.log(`✓ ${scriptName} completed in ${duration}ms`);

    } catch (error) {
        const duration = Date.now() - startTime;
        const errorMessage = error instanceof Error ? error.message : String(error);

        // Check if it was a timeout
        const isTimeout = errorMessage.includes('timed out after');
        const resultMessage = isTimeout
            ? `Script timed out after ${timeoutMs}ms`
            : `Script failed: ${errorMessage}`;

        // Update script error result
        const scriptResult: SelfCheckResult = {
            success: false,
            message: resultMessage,
            timestamp: new Date(),
            duration
        };

        await ctx.update(data => ({
            ...data,
            scripts: {
                ...data.scripts,
                [scriptName]: scriptResult
            }
        }));

        if (isTimeout) {
            console.error(`⏰ ${scriptName} timed out after ${timeoutMs}ms`);
        } else {
            console.error(`✗ ${scriptName} failed: ${errorMessage}`);
        }
    }
}

