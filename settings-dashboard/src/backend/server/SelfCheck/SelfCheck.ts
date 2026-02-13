import {executeHostCommand} from "@/backend/cmd/HostExecutor";
import * as path from 'path';
import {getConfig} from "@/configuration/getConfigBackend";
import { JsonFileContext } from '../SimpleMutex';
import {SelfCheckResult, SelfCheckStatus} from "./SelfCheckTypes";
import * as fs from 'fs/promises';

// Constants
const REMOTE_DATA_APP = getConfig("COMPOSE_FOLDER_PATH") || "/DATA/AppData/casaos/apps/yundera/";
const REMOTE_SCRIPT_DIR = `${REMOTE_DATA_APP}/scripts`;

// Path to the shared configuration file
const SCRIPTS_CONFIG_FILE = path.join(REMOTE_SCRIPT_DIR, 'self-check', 'scripts-config.txt');

/**
 * Read self-check scripts from the configuration file
 * Returns array of script names in execution order
 * Throws error if SSH connection fails (no fallback)
 */
async function loadSelfCheckScripts(): Promise<string[]> {
    try {
        const configContent = await executeHostCommand(`cat "${SCRIPTS_CONFIG_FILE}"`);
        return parseScriptsList(configContent.stdout || configContent);
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        throw new Error(
            `Failed to load self-check scripts from host: ${errorMsg}\n` +
            `Possible causes:\n` +
            `  - SSH connection to host not established\n` +
            `  - scripts-config.txt does not exist at ${SCRIPTS_CONFIG_FILE}\n` +
            `  - Template sync has not run yet\n` +
            `Debug: Check SSH connectivity and verify file exists on host.`
        );
    }
}

/**
 * Pre-flight check to verify SSH connectivity to host
 * Returns status object - warning only, doesn't block execution
 */
async function checkSSHConnectivity(): Promise<{ connected: boolean; message: string }> {
    try {
        await executeHostCommand('echo "ssh-check-ok"');
        return { connected: true, message: 'SSH connection to host verified' };
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.warn(`[Self-Check] SSH pre-flight check failed: ${errorMsg}`);
        return {
            connected: false,
            message: `SSH connection failed: ${errorMsg}`
        };
    }
}

/**
 * Parse the scripts configuration file content
 * Skips comments (lines starting with #) and empty lines
 */
function parseScriptsList(content: string): string[] {
    return content
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0 && !line.startsWith('#'));
}

// Default status
const DEFAULT_STATUS: SelfCheckStatus = {
    isRunning: false,
    overallStatus: 'never_run',
    scripts: {},
    connectionError: undefined
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
            scripts: {},
            connectionError: undefined
        };
    });

    if (!canStart) {
        throw new Error('Self-check is already running');
    }

    try {
        // Pre-flight SSH check (warn only, don't block)
        const sshCheck = await checkSSHConnectivity();
        if (!sshCheck.connected) {
            console.warn(`[Self-Check] Pre-flight warning: ${sshCheck.message}`);
        }

        // Load scripts from configuration file - this will throw if SSH fails
        const selfCheckScripts = await loadSelfCheckScripts();
        console.log(`Loaded ${selfCheckScripts.length} self-check scripts from host`);

        let successCount = 0;
        const totalCount = selfCheckScripts.length;

        // Run all self-check scripts
        for (const scriptName of selfCheckScripts) {
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
            overallStatus,
            connectionError: undefined
        }));

        console.log(`Self-check completed: ${successCount}/${totalCount} scripts succeeded`);
        console.log(`Overall status: ${overallStatus}`);

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        // Determine if this is a connection/infrastructure error vs script error
        const isConnectionError = errorMessage.includes('Failed to load self-check scripts') ||
                                  errorMessage.includes('Failed to execute host command');

        await ctx.update(data => ({
            ...data,
            isRunning: false,
            overallStatus: isConnectionError ? 'connection_failed' : 'failure',
            connectionError: isConnectionError ? errorMessage : undefined
        }));

        console.error(`[Self-Check] ${isConnectionError ? 'Connection' : 'Execution'} error:`, errorMessage);
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

