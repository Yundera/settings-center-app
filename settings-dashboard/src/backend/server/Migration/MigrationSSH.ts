import { executeHostCommand } from '@/backend/cmd/HostExecutor';
import type { MigrationRequest } from './MigrationTypes';

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

// Migration keypair stash on the source host. /tmp is world-writable, so the
// `admin` sudoer (the user the orchestrator container SSHes in as) can always
// create files here regardless of how /home/admin ended up owned. Earlier this
// path lived under /home/admin/.yundera-migration, but on some Contabo cloud
// images admin's home is root-owned (admin pre-exists without a home dir, so
// `useradd -m` in ensure-admin-user.sh is skipped and the first mkdir under
// /home/admin happens as root), which broke the very first migration step with
// "mkdir: Permission denied". /tmp removes that coupling. It is also ephemeral
// — abandoned keys from a crashed migration get cleaned up on the next reboot;
// the normal happy path is handled by cleanupMigrationKey at the end of the
// pipeline. The host still runs all privileged migration work (rsync of /DATA,
// sudo on remote); the key just needs to exist on the host's disk for `ssh -i`
// to read.
const MIGRATION_KEY_DIR_ON_HOST = '/tmp/yundera-migration';

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

/* ------------------------------------------------------------------ *
 *  Transient-failure handling for target SSH
 *
 *  The migration target is a freshly-provisioned cloud VM, and fresh
 *  cloud VMs reboot on their own — an unattended-upgrades auto-reboot or
 *  a cloud-init late reboot — in the minutes after provisioning. That
 *  drops sshd for a 1–3 minute window exactly when the source pipeline
 *  first reaches in (preflight passes, then push_key hits a refused
 *  connection seconds later). Without retry, that single blip kills the
 *  whole migration. These helpers make every password-auth target-SSH
 *  call ride over such a window instead of failing on the first error.
 * ------------------------------------------------------------------ */

/** ssh/network-level failures a later retry can plausibly clear. */
const TRANSIENT_SSH_PATTERNS: RegExp[] = [
    /connection refused/i,          // sshd not listening yet (late boot / early shutdown)
    /connection timed out/i,        // host networking not up
    /operation timed out/i,
    /connection reset/i,            // sshd accepted then dropped (still starting)
    /connection closed by/i,        // ditto, or a MaxStartups throttle
    /kex_exchange_identification/i, // sshd answering before it is fully ready
    /no route to host/i,            // host network mid-reboot
    /host is down/i,
    /timed out waiting for/i,
];

/**
 * True when an error from a target-SSH call looks like a transient
 * connection-level failure (host rebooting, sshd not up yet) rather than
 * a permanent one. Deliberately does NOT match "Permission denied"
 * (wrong password — retrying cannot help) or "REMOTE HOST IDENTIFICATION
 * HAS CHANGED" (host-key mismatch — needs `ssh-keygen -R`, not a retry).
 */
export function isTransientSSHError(err: unknown): boolean {
    const msg = err instanceof Error ? err.message : String(err);
    return TRANSIENT_SSH_PATTERNS.some(re => re.test(msg));
}

/** Redact a one-time migration password out of text before it is logged. */
function redactSshpass(s: string): string {
    return s.replace(/SSHPASS=\S+/g, 'SSHPASS=***');
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export interface SSHRetryOptions {
    /** Total attempts, including the first. Default 8. */
    attempts?: number;
    /** Delay between attempts, in ms. Default 10000. */
    delayMs?: number;
    /** Label used in retry log lines. */
    label?: string;
}

/**
 * Run an SSH operation, retrying while it fails with a transient
 * connection-level error. Non-transient errors (auth failure, a remote
 * script exiting non-zero, host-key mismatch) are rethrown immediately —
 * retrying those only wastes time.
 */
export async function retryTransientSSH<T>(
    fn: () => Promise<T>,
    opts?: SSHRetryOptions,
): Promise<T> {
    const attempts = opts?.attempts ?? 8;
    const delayMs = opts?.delayMs ?? 10_000;
    const label = opts?.label ?? 'target SSH';

    let lastErr: unknown;
    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            return await fn();
        } catch (err) {
            lastErr = err;
            if (attempt >= attempts || !isTransientSSHError(err)) {
                throw err;
            }
            const detail = redactSshpass(err instanceof Error ? err.message : String(err));
            console.warn(
                `[Migration] ${label}: transient SSH failure on attempt ${attempt}/${attempts}, ` +
                `retrying in ${delayMs / 1000}s — ${detail}`,
            );
            await sleep(delayMs);
        }
    }
    throw lastErr;
}

/**
 * Build the password-auth SSH command used to reach the target during
 * preflight and the one-time key push. The password is passed via the
 * SSHPASS env var — never on argv, where it would land in
 * /proc/<pid>/cmdline and host shell history.
 */
function buildSshpassToTargetCommand(req: MigrationRequest, remoteCmd: string): string {
    return [
        `SSHPASS=${shq(req.password)}`,
        'sshpass',
        '-e',
        'ssh',
        '-o', 'StrictHostKeyChecking=accept-new',
        '-o', 'ConnectTimeout=10',
        '-o', 'PreferredAuthentications=password',
        '-o', 'PubkeyAuthentication=no',
        `${req.user}@${req.host}`,
        shq(remoteCmd),
    ].join(' ');
}

/**
 * Run a command on the target via password auth, retrying over transient
 * connection failures. Used by preflight and the key-push step only;
 * everything after push_key uses key auth (execOnTarget).
 */
export async function sshpassToTarget(
    req: MigrationRequest,
    remoteCmd: string,
    opts?: SSHRetryOptions,
): Promise<{ stdout: string; stderr: string }> {
    return retryTransientSSH(
        () => executeHostCommand(buildSshpassToTargetCommand(req, remoteCmd)),
        { label: `target ${req.host}`, ...opts },
    );
}

/**
 * Poll the target until a trivial SSH command succeeds, or give up.
 *
 * Called at the start of push_key (and used as preflight's reachability
 * check) so the pipeline waits out a post-provision reboot of the
 * freshly-allocated target VM instead of failing the migration on the
 * first refused connection. The default budget (~4 minutes) is
 * comfortably longer than a small cloud VM's reboot cycle; a target
 * still unreachable after that is treated as a real failure.
 *
 * A wrong password fails fast — "Permission denied" is not transient, so
 * retryTransientSSH rethrows it on the first attempt rather than waiting
 * out the whole budget.
 */
export async function waitForTargetSSH(
    req: MigrationRequest,
    opts?: { attempts?: number; delayMs?: number },
): Promise<void> {
    const attempts = opts?.attempts ?? 24;
    const delayMs = opts?.delayMs ?? 10_000;
    console.log(
        `[Migration] waiting for target ${req.host} to accept SSH ` +
        `(up to ${(attempts * delayMs) / 60_000} min)…`,
    );
    const out = await retryTransientSSH(
        () => executeHostCommand(buildSshpassToTargetCommand(req, 'echo READY')),
        { attempts, delayMs, label: `target ${req.host} readiness` },
    );
    if (!out.stdout.includes('READY')) {
        throw new Error(
            `Target ${req.host} answered SSH but the readiness probe returned ` +
            `unexpected output: ${out.stdout.slice(0, 200)}`,
        );
    }
}

export const MIGRATION_PATHS = {
    keyDirOnHost: MIGRATION_KEY_DIR_ON_HOST,
    dataRoot: '/DATA',
};
