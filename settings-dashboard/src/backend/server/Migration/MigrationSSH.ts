import { executeHostCommand } from '@/backend/cmd/HostExecutor';

/**
 * Shared SSH primitives for migration.
 *
 * The migration orchestrator runs inside the settings-center-app container.
 * The container SSHes to its own host (target PCS) via executeHostCommand.
 * The target host then SSHes/rsyncs to the source PCS.
 *
 * Why this hop: rsync/sshpass aren't guaranteed to be installed in the
 * container, and running transfers on the host avoids a pointless
 * source → host → container → disk path.
 */

export interface MigrationKeyPair {
    /** Path on target *host* (not container) to the generated private key. */
    privateKeyPath: string;
    /** Public key contents. */
    publicKey: string;
    /** Unix user created on the source PCS for migration. */
    migrationUser: string;
    /** Timestamped suffix used for isolating this run's artifacts. */
    runId: string;
}

const MIGRATION_KEY_DIR_ON_HOST = '/root/.yundera-migration';

export function newRunId(): string {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}

/**
 * Shell-quote a value for safe single-argument substitution.
 * Wraps in single quotes and escapes any single quotes inside.
 */
export function shq(s: string): string {
    return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * Build the SSH command used to talk to the source from the target host.
 * Uses key auth, strict options, and a short connect timeout.
 */
export function sourceSSHCommand(keypair: MigrationKeyPair, remote: string, cmd: string): string {
    return [
        'ssh',
        '-i', shq(keypair.privateKeyPath),
        '-o', 'StrictHostKeyChecking=accept-new',
        '-o', 'BatchMode=yes',
        '-o', 'ConnectTimeout=10',
        `${keypair.migrationUser}@${remote}`,
        shq(cmd),
    ].join(' ');
}

/**
 * Execute a command on the source PCS via the target host.
 */
export async function execOnSource(
    keypair: MigrationKeyPair,
    remote: string,
    cmd: string,
    opts?: { sudo?: boolean; timeout?: number }
): Promise<{ stdout: string; stderr: string }> {
    const full = opts?.sudo ? `sudo -n ${cmd}` : cmd;
    const sshCmd = sourceSSHCommand(keypair, remote, full);
    return executeHostCommand(sshCmd, { timeout: opts?.timeout });
}

export const MIGRATION_PATHS = {
    keyDirOnHost: MIGRATION_KEY_DIR_ON_HOST,
    dataRoot: '/DATA',
};
