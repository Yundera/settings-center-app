import { executeHostCommand } from '@/backend/cmd/HostExecutor';

/**
 * Shared SSH primitives for migration.
 *
 * The migration orchestrator runs inside the settings-center-app container on
 * the SOURCE PCS. The container SSHes to its own host (the source PCS) via
 * executeHostCommand. The source host then SSHes / rsyncs to the TARGET PCS
 * (which is bare apart from a sudoer migration account the user enabled there
 * via the target's own UI).
 *
 * Why this hop: rsync/sshpass aren't guaranteed to be installed in the
 * container, and running transfers on the host avoids a pointless
 * container → host → network → target path.
 */

export interface MigrationKeyPair {
    /** Path on source *host* (not container) to the generated private key. */
    privateKeyPath: string;
    /** Public key contents — installed in the target migration user's authorized_keys. */
    publicKey: string;
    /** Migration user account on the target PCS (typically `migration`). */
    migrationUser: string;
    /** Timestamped suffix used for isolating this run's artifacts. */
    runId: string;
}

// The migration orchestrator SSHes to the source host as the `admin` sudoer
// and writes its keypair under admin's home (admin can't write /root).
// Privileged steps (rsync of /DATA, sudo on remote) elevate via sudo on the
// commands themselves, not via this directory's location.
const MIGRATION_KEY_DIR_ON_HOST = '/home/admin/.yundera-migration';

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
 * Bracket-wrap an IPv6 address for tools that parse `host:port` or
 * `user@host:path` and would otherwise misinterpret the embedded colons.
 * Bare-host (IPv4 / DNS) passes through unchanged. Used by rsync's
 * `user@host:/path` remote spec — OpenSSH's `user@host` form does NOT
 * need this and bracket-wrapping there would break it.
 *
 * Heuristic: any colon means IPv6 (IPv4 octets and DNS labels can't
 * contain colons).
 */
export function bracketIpv6(host: string): string {
    return host.includes(':') ? `[${host}]` : host;
}

/**
 * Build the SSH command used to talk to the target from the source host.
 * Uses key auth, strict options, and a short connect timeout.
 */
export function targetSSHCommand(keypair: MigrationKeyPair, target: string, cmd: string): string {
    return [
        'ssh',
        '-i', shq(keypair.privateKeyPath),
        '-o', 'StrictHostKeyChecking=accept-new',
        '-o', 'BatchMode=yes',
        '-o', 'ConnectTimeout=10',
        `${keypair.migrationUser}@${target}`,
        shq(cmd),
    ].join(' ');
}

/**
 * Execute a command on the target PCS via the source host.
 */
export async function execOnTarget(
    keypair: MigrationKeyPair,
    target: string,
    cmd: string,
    opts?: { sudo?: boolean; timeout?: number }
): Promise<{ stdout: string; stderr: string }> {
    const full = opts?.sudo ? `sudo -n ${cmd}` : cmd;
    const sshCmd = targetSSHCommand(keypair, target, full);
    return executeHostCommand(sshCmd, { timeout: opts?.timeout });
}

export const MIGRATION_PATHS = {
    keyDirOnHost: MIGRATION_KEY_DIR_ON_HOST,
    dataRoot: '/DATA',
};
