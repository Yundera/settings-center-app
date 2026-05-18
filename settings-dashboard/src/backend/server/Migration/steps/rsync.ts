import { spawn } from 'child_process';
import { MigrationKeyPair, bracketIpv6, shq } from '../MigrationSSH';
import { RsyncProgress } from '../MigrationTypes';
import { detectHostIP } from '@/backend/cmd/HostExecutor';

/**
 * Runs rsync from this PCS (the source) /DATA to the target PCS /DATA,
 * streaming progress.
 *
 * Runs by invoking ssh from the CONTAINER back to the SOURCE HOST, which
 * then runs rsync. The rsync process on the source host drives the transfer
 * (local /DATA → target /DATA over SSH). This mirrors the HostExecutor
 * pattern used throughout the app — we never run rsync in the container
 * itself.
 *
 * Progress parsing: `--info=progress2` emits periodic lines shaped like
 *   `  123,456,789  42%  123.45MB/s  0:12:34 (xfr#42, ir-chk=1234/5678)`
 * We sample the most recent line for the UI.
 */

// Flag rationale (in order):
//   -a   archive: recursive + symlinks + perms + times + group + owner + special files
//   -H   preserve hard links (in-memory inode map; correct on trees that use them)
//   -A   preserve ACLs
//   -X   preserve extended attributes (SELinux contexts, file capabilities, etc.)
//   -S   sparse-aware: postgres heap files, qcow2/vmdk images, pre-allocated
//        media files etc. stay sparse on the destination instead of being
//        materialised to full physical size. Safe here because we never use
//        --inplace (the unsafe combo). Without -S a 100 GB sparse file
//        becomes 100 GB on disk on the target.
//   -x   one-file-system: do not cross mount points. Critical to skip FUSE
//        mounts under /DATA (meta-fuse, rclone, sshfs etc.) — without this
//        rsync would pull data through the FUSE driver over the network and
//        push it to the target, which then re-mounts the same backend on
//        top, creating divergent local copies of remote storage. Also skips
//        bind / NFS / SMB mounts for the same reason.
//   --numeric-ids       keep UIDs/GIDs numeric (no name-mapping across hosts)
//   --info=progress2…   periodic progress lines for the UI to parse
//   --partial           keep partial transfers so resume works after a crash
const RSYNC_FLAGS_COMMON = [
    '-aHAXS',
    '-x',
    '--numeric-ids',
    '--info=progress2,stats2',
    '--partial',
];

export interface RsyncOptions {
    keypair: MigrationKeyPair;
    target: string;
    deleteFlag: boolean;
    onProgress: (p: RsyncProgress) => Promise<void>;
    isCancelled: () => Promise<boolean>;
}

export async function runRsync(opts: RsyncOptions): Promise<void> {
    const { keypair, target, deleteFlag, onProgress, isCancelled } = opts;

    // Build the `ssh -e` argument rsync uses to connect to the target
    const rshArg = [
        'ssh',
        '-i', keypair.privateKeyPath,
        '-o', 'StrictHostKeyChecking=accept-new',
        '-o', 'BatchMode=yes',
    ].join(' ');

    // rsync reads /DATA on the source host (sudo for permissions on others'
    // home dirs etc.) and writes via the target migration user's sudo
    // (--rsync-path=sudo rsync) — so the target side runs rsync as root.
    const flags = [...RSYNC_FLAGS_COMMON];
    if (deleteFlag) flags.push('--delete');

    const localSource = '/DATA/';
    const remoteSpec = `${keypair.migrationUser}@${bracketIpv6(target)}:/DATA/`;

    // We invoke rsync via `ssh -t source-host "..."` so it runs on the source
    // host, not in the container. executeHostCommand buffers output — we
    // need streaming for progress, so we build our own streaming SSH invocation.
    // The host login is the `admin` sudoer; the leading `sudo rsync` below
    // elevates so rsync can read every owner's files under /DATA.
    const hostSshKey = '/app/container_ssh_key';
    const hostUser = 'admin';
    const sourceHost = await resolveSourceHost();

    const rsyncOnHost = [
        'sudo', '-n', 'rsync',
        ...flags,
        shq('--rsync-path=sudo -n rsync'),
        `--rsh=${shq(rshArg)}`,
        shq(localSource),
        shq(remoteSpec),
    ].join(' ');

    const args = [
        '-i', hostSshKey,
        '-o', 'StrictHostKeyChecking=no',
        '-o', 'BatchMode=yes',
        `${hostUser}@${sourceHost}`,
        rsyncOnHost,
    ];

    await new Promise<void>((resolve, reject) => {
        const child = spawn('ssh', args);
        let lastStderr = '';
        let lastStdoutChunk = '';

        const cancelInterval = setInterval(async () => {
            try {
                if (await isCancelled()) {
                    clearInterval(cancelInterval);
                    child.kill('SIGTERM');
                }
            } catch {}
        }, 2000);

        child.stdout.on('data', chunk => {
            const text = chunk.toString();
            lastStdoutChunk += text;
            // rsync uses \r to rewrite the progress line
            const lines = lastStdoutChunk.split(/[\r\n]/);
            lastStdoutChunk = lines.pop() || '';
            for (const line of lines) {
                const p = parseProgressLine(line);
                if (p) {
                    onProgress(p).catch(() => {});
                }
            }
        });

        child.stderr.on('data', chunk => {
            lastStderr += chunk.toString();
            if (lastStderr.length > 4096) lastStderr = lastStderr.slice(-4096);
        });

        child.on('error', err => {
            clearInterval(cancelInterval);
            reject(err);
        });

        child.on('close', code => {
            clearInterval(cancelInterval);
            if (code === 0 || code === 24 /* vanished source files — harmless */) {
                resolve();
            } else {
                reject(new Error(`rsync exited with code ${code}: ${lastStderr.slice(-1000)}`));
            }
        });
    });
}

/**
 * Resolve the source PCS's host address from inside the container. Delegates
 * to HostExecutor.detectHostIP so this step uses the same detection
 * (HOST_ADDRESS env → default gateway → docker0 → 'host.docker.internal'
 * last-resort) as every other call site. The previous implementation
 * skipped detection entirely and went straight to 'host.docker.internal'
 * when HOST_ADDRESS was unset, which fails on bare-metal/VPS PCS where
 * 'host.docker.internal' isn't resolvable.
 */
async function resolveSourceHost(): Promise<string> {
    return detectHostIP();
}

/**
 * Parse rsync --info=progress2 line:
 *   "  123,456,789  42%  123.45MB/s  0:12:34 (xfr#42, ir-chk=1234/5678)"
 */
function parseProgressLine(line: string): RsyncProgress | null {
    const trimmed = line.trim();
    if (!trimmed) return null;
    // Match the progress2 shape
    const m = trimmed.match(/^([\d,]+)\s+(\d+)%\s+(\S+)\s+(\d+:\d+:\d+)/);
    if (!m) return null;
    const bytesTransferred = parseInt(m[1].replace(/,/g, ''), 10);
    const percent = parseInt(m[2], 10);
    const throughput = m[3];
    const eta = m[4];
    return {
        bytesTransferred: Number.isFinite(bytesTransferred) ? bytesTransferred : 0,
        percent: Number.isFinite(percent) ? percent : undefined,
        throughput,
        eta,
    };
}
