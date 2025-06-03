import {executeHostCommand} from "@/backend/cmd/HostExecutor";
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import {getConfig} from "@/configuration/getConfigBackend";
import {SelfCheckStatus, SelfCheckResult} from "@/backend/server/SelfCheck/SelfCheckTypes";
import SelfCheckContext from "./SelfCheckContext";

const REMOTE_SCRIPT_DIR = `${getConfig("COMPOSE_FOLDER_PATH")}/scripts`;
const REFERENCE_DIR = '/app/template-setup/root';
const TARGET_DIR = '/app/data';
const IGNORE_FILE = path.join(TARGET_DIR, '.ignore');

const SELF_CHECK_SCRIPTS = [
    'ensure-pcs-user.sh',
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
    'ensure-user-compose-stack-up.sh'
];

// Internal context instance - not exposed to external APIs
let internalContext: SelfCheckContext | null = null;

async function getInternalContext(): Promise<SelfCheckContext> {
    if (!internalContext) {
        internalContext = SelfCheckContext.getInstance();
        await internalContext.initialize();
    }
    return internalContext;
}

// =====  EXISTING PUBLIC API - NO CHANGES REQUIRED BY API LAYER =====

export function getSelfCheckStatus(): SelfCheckStatus {
    // Try to get from internal context first, fallback to default
    if (internalContext) {
        return internalContext.getDataSync();
    }

    // Return default status if context not initialized yet
    return {
        isRunning: false,
        overallStatus: 'never_run',
        scripts: {}
    };
}

// Async version for when you can use await
export async function getSelfCheckStatusAsync(): Promise<SelfCheckStatus> {
    const context = await getInternalContext();
    return await context.getData();
}

export async function runSelfCheck(): Promise<void> {
    const context = await getInternalContext();

    // Atomically check and set running state using the internal context
    const wasAbleToStart = await context.tryStartSelfCheck();
    if (!wasAbleToStart) {
        throw new Error('Self-check is already running');
    }

    let successCount = 0;
    let totalCount = SELF_CHECK_SCRIPTS.length;

    try {
        console.log('Starting self-check process...');

        // Run file integrity check first
        await checkSelfIntegrity();

        // Run all self-check scripts
        for (const scriptName of SELF_CHECK_SCRIPTS) {
            const scriptPath = path.join(REMOTE_SCRIPT_DIR, 'self-check', scriptName);
            const startTime = Date.now();

            try {
                console.log(`Running: ${scriptName}`);

                // Execute the script
                const result = await executeHostCommand(scriptPath);
                const duration = Date.now() - startTime;

                // Atomically update this script's result using the internal context
                const scriptResult: SelfCheckResult = {
                    success: true,
                    message: `Script completed successfully`,
                    timestamp: new Date(),
                    duration
                };

                await context.updateScriptResult(scriptName, scriptResult);
                successCount++;
                console.log(`✓ ${scriptName} completed in ${duration}ms`);

            } catch (error) {
                const duration = Date.now() - startTime;
                const errorMessage = error instanceof Error ? error.message : String(error);

                // Atomically update this script's error result using the internal context
                const scriptResult: SelfCheckResult = {
                    success: false,
                    message: `Script failed: ${errorMessage}`,
                    timestamp: new Date(),
                    duration
                };

                await context.updateScriptResult(scriptName, scriptResult);
                console.error(`✗ ${scriptName} failed: ${errorMessage}`);
            }
        }

        // Determine overall status and mark as not running
        let overallStatus: 'success' | 'failure' | 'partial';
        if (successCount === totalCount) {
            overallStatus = 'success';
        } else if (successCount === 0) {
            overallStatus = 'failure';
        } else {
            overallStatus = 'partial';
        }

        // Atomically finalize the self-check using the internal context
        await context.finalizeSelfCheck(overallStatus);

        console.log(`Self-check completed: ${successCount}/${totalCount} scripts succeeded`);
        console.log(`Overall status: ${overallStatus}`);

    } catch (error) {
        // Ensure we clear the running state even if something goes wrong
        await context.finalizeSelfCheck('failure');
        throw error;
    }
}

// ===== INTERNAL HELPER FUNCTIONS =====

async function checkSelfIntegrity(): Promise<void> {
    const context = await getInternalContext();
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

        // Atomically update the integrity check result using the internal context
        const integrityResult: SelfCheckResult = {
            success,
            message: success
                ? `Integrity check completed: ${filesFixed} files fixed, ${filesRemoved} files removed`
                : `Integrity check completed with ${errors.length} errors: ${filesFixed} files fixed, ${filesRemoved} files removed`,
            timestamp: new Date(),
            duration
        };

        // Use the internal context method for setting integrity check result
        await context.setIntegrityCheckResult(integrityResult);

        console.log(`Integrity check completed in ${duration}ms`);
        console.log(`Files fixed: ${filesFixed}, Files removed: ${filesRemoved}, Errors: ${errors.length}`);

        if (!success) {
            throw new Error(`Integrity check failed with ${errors.length} errors`);
        }

    } catch (error) {
        const duration = Date.now() - startTime;
        const errorMessage = error instanceof Error ? error.message : String(error);

        // Atomically update the integrity check error using the internal context
        const integrityResult: SelfCheckResult = {
            success: false,
            message: `Integrity check failed: ${errorMessage}`,
            timestamp: new Date(),
            duration
        };

        await context.setIntegrityCheckResult(integrityResult);

        console.error(`Integrity check failed: ${errorMessage}`);
        throw error;
    }
}

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
        // If .ignore file doesn't exist, return empty patterns
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
    // Simple glob-like pattern matching
    // Convert glob pattern to regex
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

// ===== CLEANUP AND UTILITIES =====

// Optional: Export for manual cleanup if needed
export async function cleanupSelfCheckContext(): Promise<void> {
    if (internalContext) {
        await internalContext.cleanup();
        internalContext = null;
    }
}

// Optional: Get context instance for advanced operations (internal use)
export async function getSelfCheckContext(): Promise<SelfCheckContext> {
    return await getInternalContext();
}