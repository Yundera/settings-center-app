import { execute } from "@/backend/cmd/LocalExecutor";
import { promises as fs } from 'fs';
import path from 'path';
import {getConfig} from "@/configuration/getConfigBackend";

const adminKeyComment = 'local-admin-access';
const defaultAuthorizedKeysPath = '/host_ssh/authorized_keys';
const defaultPrivateKeyPath = '/app/container_ssh_key';
const defaultHostUser = 'root';

/**
 * Detects the host IP address from inside the container
 * @returns Promise<string> - Host IP address
 */
async function detectHostIP(): Promise<string> {
    if(getConfig("HOST_ADDRESS")){
        return getConfig("HOST_ADDRESS");
    }
    try {
        // Try to get the default gateway IP (works on Linux)
        const result = await execute("ip route show default | awk '/default/ {print $3}'",false);
        const hostIP = result.stdout.trim();

        if (hostIP && hostIP.match(/^\d+\.\d+\.\d+\.\d+$/)) {
            return hostIP;
        }

        // Fallback: try to parse docker0 interface
        const dockerResult = await execute("ip route | grep docker0 | awk '{print $1}' | head -1",false);
        const dockerNetwork = dockerResult.stdout.trim();

        if (dockerNetwork) {
            // Extract gateway from network (usually .1)
            const networkParts = dockerNetwork.split('/')[0].split('.');
            networkParts[3] = '1';
            const gatewayIP = networkParts.join('.');
            return gatewayIP;
        }

        // Last resort fallback
        return 'host.docker.internal';

    } catch (error) {
        console.warn('Error detecting host IP, falling back to host.docker.internal:', error);
        return 'host.docker.internal';
    }
}

/**
 * Generates an SSH key pair for container-to-host communication
 * @returns Promise<{publicKey: string, privateKeyPath: string}>
 */
export async function generateSSHKey(): Promise<{publicKey: string, privateKeyPath: string}> {
    try {
        // Generate SSH key with ed25519 algorithm
        const passphrase = '';

        // Execute ssh-keygen command
        const sshKeygenCmd = `ssh-keygen -t ed25519 -f ${defaultPrivateKeyPath} -N "${passphrase}" -C "${adminKeyComment}-$(date +%s)"`;

        await execute(sshKeygenCmd,false);

        // Read the generated public key
        const publicKeyContent = await fs.readFile(`${defaultPrivateKeyPath}.pub`, 'utf8');

        console.log('SSH key pair generated successfully');

        return {
            publicKey: publicKeyContent.trim(),
            privateKeyPath: path.resolve(defaultPrivateKeyPath)
        };

    } catch (error) {
        console.error('Error generating SSH key:', error);
        throw new Error(`Failed to generate SSH key: ${error}`);
    }
}

/**
 * Executes a command on the host system via SSH
 * @param command - The command to execute on the host
 * @param options - Optional configuration
 * @returns Promise<string> - Command output
 */
export async function executeHostCommand(
    command: string,
    options?: {
        host?: string;
        user?: string;
        keyPath?: string;
        timeout?: number;
        autoDetectHost?: boolean;
    }
): Promise<{ stdout: string, stderr: string }> {
    try {
        const {
            user = defaultHostUser,
            keyPath = defaultPrivateKeyPath,
            timeout = 30000,
            autoDetectHost = true
        } = options || {};

        // Determine host IP
        let host = options?.host;
        if (!host && autoDetectHost) {
            host = await detectHostIP();
        } else if (!host) {
            host = 'host.docker.internal'; // fallback
        }

        // Ensure the private key has correct permissions
        await execute(`chmod 600 ${keyPath}`,false);

        // SSH command with options
        const sshCmd = [
            'ssh',
            '-i', keyPath,
            '-o', 'StrictHostKeyChecking=no',
            //'-o', 'UserKnownHostsFile=/dev/null',
            '-o', `ConnectTimeout=${Math.floor(timeout / 1000)}`,
            '-o', 'BatchMode=yes',
            `${user}@${host}`,
            `"${command.replace(/"/g, '\\"')}"`
        ].join(' ');

        // Execute the SSH command
        const result = await execute(sshCmd,false);

        return result;

    } catch (error) {
        throw new Error(`Failed to execute host command "${command}" : ${ error.message || error}`);
    }
}

/**
 * Tests SSH connectivity to the host
 * @param options - Optional configuration
 * @returns Promise<boolean> - True if connection successful
 */
export async function testSSHConnection(options?: {
    host?: string;
    user?: string;
    keyPath?: string;
    autoDetectHost?: boolean;
}): Promise<boolean> {
    try {
        const result = await executeHostCommand('echo "SSH connection test successful"', options);
        return result.stdout.includes('SSH connection test successful');
    } catch (error) {
        return false;
    }
}

/**
 * Removes existing admin container keys from authorized_keys while preserving other keys
 * @param authorizedKeysPath - Path to the authorized_keys file (mapped inside container)
 */
async function cleanupAdminKeys(authorizedKeysPath: string): Promise<void> {
    try {
        // Check if authorized_keys file exists
        const fileExists = await fs.access(authorizedKeysPath).then(() => true).catch(() => false);

        if (!fileExists) {
            await fs.writeFile(authorizedKeysPath, '', 'utf8');
            await fs.chmod(authorizedKeysPath, 0o600);
            return;
        }

        // Read existing authorized_keys
        const existingKeys = await fs.readFile(authorizedKeysPath, 'utf8');

        // Split into lines and filter out admin container keys
        const keyLines = existingKeys.split('\n');
        const filteredKeys = keyLines.filter(line => {
            // Keep empty lines and keys that don't contain adminKeyComment
            return line.trim() === '' || !line.includes(adminKeyComment);
        });

        // Write back the filtered keys
        await fs.writeFile(authorizedKeysPath, filteredKeys.join('\n'), 'utf8');
        await fs.chmod(authorizedKeysPath, 0o600);

        const removedCount = keyLines.length - filteredKeys.length;
        if (removedCount > 0) {
            console.log(`Removed ${removedCount} existing admin key(s)`);
        }

    } catch (error) {
        console.error('Error cleaning up admin keys:', error);
        throw new Error(`Failed to cleanup admin keys: ${error}`);
    }
}

/**
 * Sets up SSH access by adding the public key to the host's authorized_keys
 * Uses container mapping instead of SCP
 * @param publicKey - The public key content to add
 * @param options - Optional configuration
 */
export async function setupSSHAccess(
    publicKey: string,
    options?: {
        authorizedKeysPath?: string;
        cleanupExisting?: boolean;
    }
): Promise<void> {
    try {
        const {
            authorizedKeysPath = defaultAuthorizedKeysPath,
            cleanupExisting = true
        } = options || {};

        // Step 1: Cleanup existing admin keys if requested
        if (cleanupExisting) {
            await cleanupAdminKeys(authorizedKeysPath);
        }

        // Step 2: Read existing content
        let existingContent = '';
        try {
            existingContent = await fs.readFile(authorizedKeysPath, 'utf8');
        } catch (error) {
            // File doesn't exist, create it
        }

        // Step 3: Append the new public key
        const newContent = existingContent.trim() + (existingContent.trim() ? '\n' : '') + publicKey + '\n';

        // Step 4: Write the updated content
        await fs.writeFile(authorizedKeysPath, newContent, 'utf8');
        await fs.chmod(authorizedKeysPath, 0o600);

        console.log('SSH access configured');

    } catch (error) {
        console.error('Error setting up SSH access:', error);
        throw new Error(`Failed to setup SSH access: ${error}`);
    }
}

/**
 * Clears only admin container keys while preserving other keys
 * @param options - Optional configuration
 */
export async function clearAdminKeysOnly(options?: {
    authorizedKeysPath?: string;
}): Promise<void> {
    try {
        const {
            authorizedKeysPath = defaultAuthorizedKeysPath
        } = options || {};

        await cleanupAdminKeys(authorizedKeysPath);

    } catch (error) {
        console.error('Error clearing admin keys:', error);
        throw new Error(`Failed to clear admin keys: ${error}`);
    }
}

/**
 * Waits for SSH connection to be established with retry logic
 * @param options - Configuration options
 * @returns Promise<void> - Resolves when connection is successful
 * @throws Error if connection fails after all retries
 */
export async function waitForSSHConnection(options?: {
    host?: string;
    user?: string;
    keyPath?: string;
    autoDetectHost?: boolean;
    maxRetries?: number;
    retryDelay?: number; // in milliseconds
}): Promise<void> {
    const {
        maxRetries = 10,
        retryDelay = 2000, // 2 seconds
        ...sshOptions
    } = options || {};

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        console.log(`Attempting SSH connection (${attempt}/${maxRetries})...`);

        const isConnected = await testSSHConnection(sshOptions);

        if (isConnected) {
            console.log(`SSH connection established successfully on attempt ${attempt}`);
            return;
        }

        if (attempt < maxRetries) {
            console.log(`SSH connection failed, retrying in ${retryDelay}ms...`);
            await new Promise(resolve => setTimeout(resolve, retryDelay));
        }
    }

    throw new Error(`Failed to establish SSH connection after ${maxRetries} attempts`);
}

/**
 * Complete workflow to generate key and setup SSH access
 * This automatically cleans up existing admin keys before adding the new one
 */
export async function initializeSSHAccess(): Promise<void> {
    try {
        // Step 1: Generate SSH key
        const { publicKey, privateKeyPath } = await generateSSHKey();

        // Step 2: Setup SSH access (includes cleanup of existing admin keys)
        await setupSSHAccess(publicKey, { cleanupExisting: true });

        // Step 3: Test the connection Wait for SSH connection to be established
        await waitForSSHConnection({
            maxRetries: 100,
            retryDelay: 3000 // 3 seconds between retries
        });

    } catch (error) {
        console.error('Failed to initialize SSH access:', error);
        throw error;
    }
}

/**
 * Lists all keys in the authorized_keys file with their types
 */
export async function listAuthorizedKeys(options?: {
    authorizedKeysPath?: string;
}): Promise<void> {
    try {
        const {
            authorizedKeysPath = defaultAuthorizedKeysPath
        } = options || {};

        const fileExists = await fs.access(authorizedKeysPath).then(() => true).catch(() => false);

        if (!fileExists) {
            console.log('No authorized_keys file found');
            return;
        }

        const content = await fs.readFile(authorizedKeysPath, 'utf8');
        const lines = content.split('\n').filter(line => line.trim() !== '');

        console.log(`${lines.length} key(s) in authorized_keys:`);
        lines.forEach((line, index) => {
            const isAdminKey = line.includes(adminKeyComment);
            const keyType = isAdminKey ? '[ADMIN]' : '[OTHER]';
            const comment = line.split(' ')[2] || 'no-comment';
            console.log(`  ${index + 1}. ${keyType} ${comment}`);
        });

    } catch (error) {
        console.error('Error listing authorized keys:', error);
        throw new Error(`Failed to list authorized keys: ${error}`);
    }
}

// Example usage:
/*
// Initialize SSH access (automatically cleans up old admin keys and tests connection)
await initializeSSHAccess();

// List all keys to verify
await listAuthorizedKeys();

// Execute commands on host (auto-detects host IP)
const result = await executeHostCommand('ls -la /home');
console.log('Host directory listing:', result);

const dockerInfo = await executeHostCommand('docker ps');
console.log('Running containers:', dockerInfo);

// Test connection manually
const isConnected = await testSSHConnection();
console.log('SSH connection status:', isConnected);

// Use specific host IP if needed (bypasses auto-detection)
const specificResult = await executeHostCommand('whoami', {
    host: '172.17.0.1',
    autoDetectHost: false
});

// If you need to clear only admin keys manually
await clearAdminKeysOnly();
*/