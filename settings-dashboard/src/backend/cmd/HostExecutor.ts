import { execute } from "@/backend/cmd/LocalExecutor";
import { promises as fs } from 'fs';
import path from 'path';
import {getConfig} from "@/configuration/getConfigBackend";

const adminKeyComment = 'local-admin-access';
const defaultAuthorizedKeysPath = '/host_ssh/authorized_keys';
export const defaultPrivateKeyPath = '/app/container_ssh_key';
export const defaultHostUser = 'admin';

const procNetRoutePath = '/proc/net/route';

/** Memoised default gateway. The container's network cannot change under it. */
let cachedHostIP: string | null = null;

/**
 * Extract the default gateway from the contents of /proc/net/route.
 *
 * The kernel prints addresses as little-endian hex, so the gateway of
 *   eth0  00000000  010012AC  0003  …
 * is AC.12.00.01 read backwards — 172.18.0.1. Exported so the parse can be
 * exercised without a container.
 */
export function parseDefaultGateway(procNetRoute: string): string | null {
    // Skip the header line.
    for (const line of procNetRoute.split('\n').slice(1)) {
        const fields = line.trim().split(/\s+/);
        if (fields.length < 4) continue;

        const [, destination, gateway, flagsHex] = fields;
        // The default route is the one matching every destination.
        if (destination !== '00000000') continue;
        // RTF_GATEWAY (0x2) — a default route with no gateway is not usable here.
        const flags = Number.parseInt(flagsHex, 16);
        if (!Number.isFinite(flags) || (flags & 0x2) === 0) continue;
        if (!/^[0-9A-Fa-f]{8}$/.test(gateway) || gateway === '00000000') continue;

        const octets: number[] = [];
        for (let i = 6; i >= 0; i -= 2) {
            octets.push(Number.parseInt(gateway.slice(i, i + 2), 16));
        }
        return octets.join('.');
    }
    return null;
}

/**
 * Address of the Docker host as seen from inside this container — the default
 * gateway, which is the bridge address the host listens on.
 *
 * Read straight out of /proc/net/route rather than shelled out to
 * `ip route show default | awk …`. Two reasons, both learned the hard way:
 *
 *  - Every host command called this, so the old version paid two fork()s per
 *    call — on top of the ssh itself — for a value that cannot change while the
 *    container lives. Now it is one file read, memoised after the first hit.
 *  - Because it forked, it was the FIRST thing to break when the container ran
 *    out of PIDs (see the ENTRYPOINT note in the Dockerfile) — and it answered
 *    that failure by returning the literal 'host.docker.internal'. That name
 *    only resolves under Docker Desktop; on a real PCS it resolves nowhere, so
 *    a PID exhaustion was reported to the operator as
 *    `ssh: Could not resolve hostname host.docker.internal`, pointing the
 *    investigation at DNS and hostnames instead of at fork(). A wrong answer
 *    that looks like a different subsystem's fault is worse than no answer:
 *    this now throws, and the throw carries the real cause.
 *
 * HOST_ADDRESS still overrides everything, which is the supported escape hatch
 * for a host that is not on the default route.
 *
 * @returns Promise<string> - Host IP address
 * @throws if the route table cannot be read or holds no usable default route
 */
export async function detectHostIP(): Promise<string> {
    const configured = getConfig("HOST_ADDRESS");
    if (configured) {
        return configured;
    }
    if (cachedHostIP) {
        return cachedHostIP;
    }

    let routeTable: string;
    try {
        routeTable = await fs.readFile(procNetRoutePath, 'utf8');
    } catch (error) {
        throw new Error(
            `Cannot determine the host address: ${procNetRoutePath} is unreadable (${error instanceof Error ? error.message : String(error)}). Set HOST_ADDRESS to override.`
        );
    }

    const gateway = parseDefaultGateway(routeTable);
    if (!gateway) {
        throw new Error(
            `Cannot determine the host address: no default gateway in ${procNetRoutePath}. Set HOST_ADDRESS to override.`
        );
    }

    cachedHostIP = gateway;
    return gateway;
}

/**
 * Generates an SSH key pair for container-to-host communication
 * @returns Promise<{publicKey: string, privateKeyPath: string}>
 */
export async function generateSSHKey(): Promise<{publicKey: string, privateKeyPath: string}> {
    try {
        // Generate SSH key with ed25519 algorithm
        const passphrase = '';

        // Remove any pre-existing key files first. ssh-keygen prompts
        // "Overwrite (y/n)?" on existing -f targets and we run it
        // non-interactively, so a leftover key from a previous boot would
        // hang the process forever. The private key lives in the container's
        // writable layer (not a volume), so it survives `docker restart`.
        await execute(`rm -f ${defaultPrivateKeyPath} ${defaultPrivateKeyPath}.pub`, false);

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
 * Returns the SSH fingerprint (SHA256:...) of the container's own key — the
 * live "dashboard" key this settings-center uses to reach the host. Returns
 * null if it can't be read or parsed (e.g. before initializeSSHAccess has
 * generated it). The fingerprint is computed the same way ssh-keygen does on
 * the host, so it can be compared directly against authorized_keys entries.
 */
export async function getContainerKeyFingerprint(): Promise<string | null> {
    try {
        const result = await execute(`ssh-keygen -lf ${defaultPrivateKeyPath}.pub`, false);
        const match = result.stdout.match(/SHA256:[A-Za-z0-9+/]+=*/);
        return match ? match[0] : null;
    } catch (error) {
        console.warn('Could not compute container key fingerprint:', error);
        return null;
    }
}

/**
 * Executes a command on the host system via SSH.
 *
 * Quoting strategy: the previous implementation wrapped `command` in outer
 * double-quotes and only escaped `"`. That broke for any command containing
 * `$`, backticks, single-quote-escape idioms (`'\''`), nested $(...), or
 * heredocs — the local /bin/sh would expand `$VARS`, mangle inner quotes,
 * or fail with `unterminated quoted string`. Migration steps with
 * non-trivial bash scripts (df, find, multi-line bash -c '...') hit this
 * repeatedly.
 *
 * New strategy: base64-encode the entire command and hand it to bash on the
 * host through PROCESS SUBSTITUTION — `bash <(echo B64 | base64 -d)`. The
 * OUTER ssh argument is then alphanumeric-only, so /bin/sh does no expansion
 * or quote interpretation at all, and the inner bash sees the script verbatim.
 *
 * Not a plain `| base64 -d | bash` pipe: that makes the decode pipe the
 * script's stdin, which breaks the `stdin` option below. See the detailed note
 * at the remoteRunner construction.
 *
 * @param command - The command to execute on the host (any valid bash script)
 * @param options - Optional configuration
 * @returns Promise<{stdout, stderr}> - Command output
 */
export async function executeHostCommand(
    command: string,
    options?: {
        host?: string;
        user?: string;
        keyPath?: string;
        timeout?: number;
        autoDetectHost?: boolean;
        /**
         * Piped to the remote command's stdin. Use this for SECRETS.
         *
         * `command` itself is base64-encoded into the ssh argv below, which is
         * obfuscation and not protection — anything in it is readable from `ps`
         * in this container and on the host. stdin is the only channel that is
         * not. See scripts/tools/onboarding.sh in template-root, which reads the
         * onboarding password this way.
         */
        stdin?: string;
    }
): Promise<{ stdout: string, stderr: string }> {
    try {
        const {
            user = defaultHostUser,
            keyPath = defaultPrivateKeyPath,
            // `timeout` is now a real hard wall-clock budget (the local
            // executor SIGKILLs the ssh tree if exceeded), not just an SSH
            // ConnectTimeout. The default is generous because some one-shot
            // callers run legitimately slow commands without passing a
            // timeout (e.g. `du -sb /DATA` in migration preflight). Callers
            // that need a tight bound — the metrics loop in particular —
            // pass their own value. A dead connection still fails fast via
            // ServerAlive regardless of this budget.
            timeout = 10 * 60 * 1000,
            autoDetectHost = true
        } = options || {};

        // Determine host IP
        let host = options?.host;
        if (!host && autoDetectHost) {
            host = await detectHostIP();
        } else if (!host) {
            // autoDetectHost:false is "I am supplying the host myself", so
            // arriving here without one is a caller bug. It used to guess
            // 'host.docker.internal', which resolves nowhere on a real PCS —
            // same trap as the one detectHostIP just stopped falling into.
            throw new Error('executeHostCommand: autoDetectHost is false but no host was supplied');
        }

        // Base64-encode the command so no character in the script gets
        // interpreted by either the local shell or the remote shell. Plain
        // ASCII (A-Z, a-z, 0-9, +, /, =) is safe inside both quote layers.
        // The remote runner MUST be a single quoted argument so the local
        // /bin/sh doesn't parse the redirection and pipeline locally — without
        // the wrapping quotes it would try to run them in the *admin container*
        // (Alpine, no bash), producing `bash: not found`.
        //
        // THE SCRIPT IS FED VIA PROCESS SUBSTITUTION, NOT A PIPE. This is
        // load-bearing and easy to "simplify" back into a bug. The obvious
        // `echo B64 | base64 -d | bash` leaves the decode pipe as bash's
        // stdin — already at EOF — so the remote script can never read the
        // `stdin` payload below, and every secret-passing caller silently gets
        // nothing (onboarding.sh dies with "no password on stdin"). With
        // `bash <(…)` the script arrives on a /dev/fd path and stdin stays
        // connected to the ssh channel, which is the whole point.
        //
        // The outer `bash -c` is deliberate too: process substitution is a
        // bash/zsh feature, and ssh runs this string through the remote user's
        // LOGIN shell, which is not guaranteed to be bash. Invoking bash
        // explicitly makes the runner independent of that. Exit codes
        // propagate through both layers unchanged.
        const commandB64 = Buffer.from(command, 'utf8').toString('base64');
        const remoteRunner = `'bash -c "bash <(echo ${commandB64} | base64 -d)"'`;

        // Connect phase gets a short bound so a dead host fails fast; the full
        // `timeout` is the hard wall-clock budget enforced by the local
        // executor (it SIGKILLs the ssh tree if exceeded).
        const connectTimeout = Math.max(1, Math.min(10, Math.floor(timeout / 1000)));

        const sshCmd = [
            'ssh',
            '-i', keyPath,
            '-o', 'StrictHostKeyChecking=no',
            '-o', `ConnectTimeout=${connectTimeout}`,
            '-o', 'BatchMode=yes',
            // Drop a connection whose host stopped responding within ~10 s
            // instead of letting it hang (matters for the shared master below).
            '-o', 'ServerAliveInterval=5',
            '-o', 'ServerAliveCountMax=2',
            // Connection multiplexing: the first call opens a master that
            // persists; subsequent calls reuse it as cheap channels instead of
            // paying a full TCP + key-exchange handshake every time. This is
            // what makes the 5 s metrics cadence affordable — the expensive
            // crypto handshake happens once, not 12 times a minute.
            //
            // The persist window is 1 h, not the 60 s it used to be, because
            // the master is not free to recreate: ssh daemonises it through a
            // double fork, so each master lifecycle orphans processes onto
            // PID 1 (harmless now that tini reaps them — see the Dockerfile
            // ENTRYPOINT note — but still churn). At 60 s against the 5 min
            // idle metrics cadence the master expired between essentially
            // every poll, so multiplexing was paying its setup cost over and
            // over and delivering none of its benefit. An hour means one
            // master per container lifetime in practice. A wedged master is
            // still dropped promptly by the ServerAlive settings above, and
            // the container mints a fresh keypair on each start, so nothing
            // depends on the master expiring quickly.
            '-o', 'ControlMaster=auto',
            '-o', 'ControlPath=/tmp/ssh-mux-%C',
            '-o', 'ControlPersist=1h',
            `${user}@${host}`,
            remoteRunner,
        ].join(' ');

        // Pass `timeout` as a hard exec budget — see LocalExecutor.execute.
        // `stdin` reaches the remote command because ssh forwards its own stdin
        // over the channel AND the remote runner above keeps that channel as
        // the script's stdin; the local executor closes the pipe so the far
        // side sees EOF instead of hanging.
        const result = await execute(sshCmd, false, timeout, options?.stdin);
        return result;
    } catch (error) {
        throw new Error(`Failed to execute host command "${command.slice(0, 200)}${command.length > 200 ? '…' : ''}" : ${ error.message || error}`);
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

        // Step 5: Match the parent .ssh dir's ownership. We run as root inside
        // the admin container, so writes land as root:root in the bind-mounted
        // volume. sshd reads authorized_keys *as the target user* (admin), and
        // a root-owned, mode-0600 file is unreadable to admin → "Permission
        // denied (publickey)" even though the key is correct. Mirroring the
        // dir's owner (set by ensure-admin-user.sh) makes the file admin-readable.
        try {
            const parentStat = await fs.stat(path.dirname(authorizedKeysPath));
            await fs.chown(authorizedKeysPath, parentStat.uid, parentStat.gid);
        } catch (error) {
            console.warn('Could not chown authorized_keys to parent dir owner:', error);
        }

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

        // Step 4: Seed the `admin` host user's authorized_keys from root if
        // empty. ensure-admin-user.sh only seeds on first run, before this
        // container has written its key to /root/.ssh/authorized_keys, which
        // leaves the admin account with 0 keys in local dev. Idempotent: a
        // no-op once admin has any key of its own.
        await seedAdminUserKeysIfEmpty();

    } catch (error) {
        console.error('Failed to initialize SSH access:', error);
        throw error;
    }
}

/**
 * Seeds /home/admin/.ssh/authorized_keys from /root/.ssh/authorized_keys when
 * the admin user has no keys. Safe to run repeatedly — does nothing if admin
 * already has keys, or if the admin user does not exist.
 */
async function seedAdminUserKeysIfEmpty(): Promise<void> {
    const innerScript = `set -e
if ! id admin >/dev/null 2>&1; then
  echo NO_ADMIN_USER
  exit 0
fi
SSH_DIR="/home/admin/.ssh"
AK="$SSH_DIR/authorized_keys"
ROOT_AK="/root/.ssh/authorized_keys"
mkdir -p "$SSH_DIR"
chmod 700 "$SSH_DIR"
touch "$AK"
# "Empty" = no non-blank, non-comment line. Treat such files as ready to seed.
if grep -Eq '^[^#[:space:]]' "$AK" 2>/dev/null; then
  echo ALREADY_HAS_KEYS
  exit 0
fi
if [ -s "$ROOT_AK" ]; then
  cp "$ROOT_AK" "$AK"
  chmod 600 "$AK"
  chown -R admin:admin "$SSH_DIR" 2>/dev/null || true
  echo SEEDED
else
  echo NO_ROOT_KEYS
fi
`;
    const scriptB64 = Buffer.from(innerScript, 'utf8').toString('base64');
    try {
        const result = await executeHostCommand(`echo ${scriptB64} | base64 -d | bash`);
        const out = result.stdout || '';
        if (out.includes('SEEDED')) {
            console.log('Seeded /home/admin/.ssh/authorized_keys from /root/.ssh/authorized_keys');
        } else if (out.includes('NO_ADMIN_USER')) {
            console.log('Admin user not present on host — skipping admin key seed');
        } else if (out.includes('NO_ROOT_KEYS')) {
            console.log('No root keys to seed admin user from');
        }
    } catch (e) {
        console.warn('Failed to seed admin user keys:', e);
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