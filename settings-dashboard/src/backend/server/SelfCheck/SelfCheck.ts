import {executeHostCommand} from "@/backend/cmd/HostExecutor";
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import {getConfig} from "@/configuration/getConfigBackend";
import { JsonFileContext } from '../SimpleMutex';
import {SelfCheckResult, SelfCheckStatus} from "./SelfCheckTypes";

// Constants
const REMOTE_DATA_APP = getConfig("COMPOSE_FOLDER_PATH") || "/DATA/AppData/casaos/apps/yundera/";
const REMOTE_SCRIPT_DIR = `${REMOTE_DATA_APP}/scripts`;
const REFERENCE_DIR = '/app/template-setup/root';
const TARGET_DIR = '/app/data';
const IGNORE_FILE = path.join(TARGET_DIR, '.ignore');

//order of scripts matters, as some depend on others
const SELF_CHECK_SCRIPTS = [
    'ensure-pcs-user.sh',
    'ensure-script-executable.sh',
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
    'ensure-template-version.sh',
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
            scripts: {},
            integrityCheck: undefined
        };
    });

    if (!canStart) {
        throw new Error('Self-check is already running');
    }

    let successCount = 0;
    const totalCount = SELF_CHECK_SCRIPTS.length;

    try {
        // Run file integrity check first
        await runIntegrityCheck(ctx);
        console.log('✓ File integrity check completed');

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

async function runIntegrityCheck(ctx: JsonFileContext<SelfCheckStatus>): Promise<void> {
    const startTime = Date.now();

    try {
        console.log('Starting file integrity check...');

        // Load ignore patterns
        const ignorePatterns = await loadIgnorePatterns();

        // Get reference files
        const referenceFiles = await getFilesRecursively(REFERENCE_DIR);
        const targetFiles = await getFilesRecursively(TARGET_DIR);

        let filesFixed = 0;
        let filesRemoved = 0;
        let errors: string[] = [];

        // Check each reference file exists and matches in target
        for (const refFile of referenceFiles) {
            const relativePath = path.relative(REFERENCE_DIR, refFile);
            const targetFile = path.join(TARGET_DIR, relativePath);

            if (shouldIgnoreFile(relativePath, ignorePatterns)) {
                continue;
            }

            try {
                const refContent = await fs.readFile(refFile);
                let targetExists = true;
                let targetContent: Buffer;

                try {
                    targetContent = await fs.readFile(targetFile);
                } catch {
                    targetExists = false;
                    targetContent = Buffer.alloc(0);
                }

                // If file doesn't exist or content differs, fix it
                if (!targetExists || !compareFileHashes(refContent, targetContent)) {
                    // Ensure target directory exists
                    await fs.mkdir(path.dirname(targetFile), { recursive: true });

                    // Copy reference file to target
                    await fs.copyFile(refFile, targetFile);
                    filesFixed++;

                    console.log(`Fixed: ${relativePath}`);
                }
            } catch (error) {
                const errorMsg = `Failed to process ${relativePath}: ${error}`;
                errors.push(errorMsg);
                console.error(errorMsg);
            }
        }

        // Remove files in target that don't exist in reference (except ignored ones)
        for (const targetFile of targetFiles) {
            const relativePath = path.relative(TARGET_DIR, targetFile);
            const refFile = path.join(REFERENCE_DIR, relativePath);

            if (shouldIgnoreFile(relativePath, ignorePatterns)) {
                continue;
            }

            try {
                await fs.access(refFile);
            } catch {
                // Reference file doesn't exist, remove target file
                try {
                    await fs.unlink(targetFile);
                    filesRemoved++;
                    console.log(`Removed: ${relativePath}`);
                } catch (error) {
                    const errorMsg = `Failed to remove ${relativePath}: ${error}`;
                    errors.push(errorMsg);
                    console.error(errorMsg);
                }
            }
        }

        const duration = Date.now() - startTime;
        const success = errors.length === 0;

        // Update integrity check result
        const integrityResult: SelfCheckResult = {
            success,
            message: success
                ? `Integrity check completed: ${filesFixed} files fixed, ${filesRemoved} files removed`
                : `Integrity check completed with ${errors.length} errors: ${filesFixed} files fixed, ${filesRemoved} files removed`,
            timestamp: new Date(),
            duration
        };

        await ctx.update(data => ({
            ...data,
            integrityCheck: integrityResult
        }));

        console.log(`Integrity check completed in ${duration}ms`);
        console.log(`Files fixed: ${filesFixed}, Files removed: ${filesRemoved}, Errors: ${errors.length}`);

        if (!success) {
            throw new Error(`Integrity check failed with ${errors.length} errors`);
        }

    } catch (error) {
        const duration = Date.now() - startTime;
        const errorMessage = error instanceof Error ? error.message : String(error);

        const integrityResult: SelfCheckResult = {
            success: false,
            message: `Integrity check failed: ${errorMessage}`,
            timestamp: new Date(),
            duration
        };

        await ctx.update(data => ({
            ...data,
            integrityCheck: integrityResult
        }));

        console.error(`Integrity check failed: ${errorMessage}`);
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

// Helper functions
function computeHash(content: Buffer): string {
    return crypto.createHash('sha256').update(content).digest('hex');
}

function compareFileHashes(content1: Buffer, content2: Buffer): boolean {
    const hash1 = computeHash(content1);
    const hash2 = computeHash(content2);
    return hash1 === hash2;
}

async function loadIgnorePatterns(): Promise<string[]> {
    try {
        const ignoreContent = await fs.readFile(IGNORE_FILE, 'utf-8');
        return ignoreContent
            .split('\n')
            .map(line => line.trim())
            .filter(line => line && !line.startsWith('#'));
    } catch {
        return [];
    }
}

function shouldIgnoreFile(filePath: string, patterns: string[]): boolean {
    for (const pattern of patterns) {
        if (matchesPattern(filePath, pattern)) {
            return true;
        }
    }
    return false;
}

function matchesPattern(filePath: string, pattern: string): boolean {
    const regexPattern = pattern
        .replace(/\./g, '\\.')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.');

    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(filePath) || regex.test(path.basename(filePath));
}

async function getFilesRecursively(dir: string): Promise<string[]> {
    const files: string[] = [];

    try {
        const entries = await fs.readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);

            if (entry.isDirectory()) {
                const subFiles = await getFilesRecursively(fullPath);
                files.push(...subFiles);
            } else if (entry.isFile()) {
                files.push(fullPath);
            }
        }
    } catch (error) {
        console.warn(`Warning: Could not read directory ${dir}: ${error}`);
    }

    return files;
}