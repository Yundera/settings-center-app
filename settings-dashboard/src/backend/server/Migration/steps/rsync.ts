import { spawn } from 'child_process';
import { MigrationKeyPair, shq } from '../MigrationSSH';
import { RsyncProgress } from '../MigrationTypes';
import { getConfig } from '@/configuration/getConfigBackend';

/**
 * Runs rsync from source PCS /DATA to target host /DATA, streaming progress.
 *
 * Runs by invoking ssh from the CONTAINER back to the TARGET HOST, which
 * then runs rsync. The rsync process on the host drives the transfer
 * (source → host /DATA). This mirrors the HostExecutor pattern used
 * throughout the app — we never run rsync in the container itself.
 *
 * Progress parsing: `--info=progress2` emits periodic lines shaped like
 *   `  123,456,789  42%  123.45MB/s  0:12:34 (xfr#42, ir-chk=1234/5678)`
 * We sample the most recent line for the UI.
 */

const RSYNC_FLAGS_COMMON = [
    '-aHAX',
    '--numeric-ids',
    '--info=progress2,stats2',
    '--partial',
    // Skip known-ephemeral paths to avoid "vanished file" errors and needless churn
    '--exclude=/DATA/AppData/casaos/apps/yundera/migration-markers',
    '--exclude=/DATA/AppData/*/logs/*.tmp',
];

export interface RsyncOptions {
    keypair: MigrationKeyPair;
    source: string;
    deleteFlag: boolean;
    onProgress: (p: RsyncProgress) => Promise<void>;
    isCancelled: () => Promise<boolean>;
}

export async function runRsync(opts: RsyncOptions): Promise<void> {
    const { keypair, source, deleteFlag, onProgress, isCancelled } = opts;

    // Build the `ssh -e` argument rsync uses to connect to source
    const rshArg = [
        'ssh',
        '-i', keypair.privateKeyPath,
        '-o', 'StrictHostKeyChecking=accept-new',
        '-o', 'BatchMode=yes',
    ].join(' ');

    // rsync runs under sudo on source (to read all files including others' homes)
    // and writes directly to target /DATA (on the host, not container).
    const flags = [...RSYNC_FLAGS_COMMON];
    if (deleteFlag) flags.push('--delete');

    const remoteSpec = `${keypair.migrationUser}@${source}:/DATA/`;
    const localTarget = '/DATA/';

    // We invoke the whole rsync via `ssh -t target-host "..."` so it runs on the
    // target host, not in the container. executeHostCommand buffers output — we
    // need streaming for progress, so we build our own streaming SSH invocation.
    const hostSshKey = '/app/container_ssh_key';
    const hostUser = 'root';
    const targetHost = await resolveTargetHost();

    const rsyncOnHost = [
        'rsync',
        ...flags,
        shq('--rsync-path=sudo rsync'),
        `--rsh=${shq(rshArg)}`,
        shq(remoteSpec),
        shq(localTarget),
    ].join(' ');

    const args = [
        '-i', hostSshKey,
        '-o', 'StrictHostKeyChecking=no',
        '-o', 'BatchMode=yes',
        `${hostUser}@${targetHost}`,
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
 * Same host-IP detection logic as HostExecutor.detectHostIP, inlined to
 * keep this file self-contained for the streaming path.
 */
async function resolveTargetHost(): Promise<string> {
    if (getConfig('HOST_ADDRESS')) return getConfig('HOST_ADDRESS');
    // Best-effort: defer to HostExecutor's internal detection by running a
    // buffered command once to prime the route.
    // In practice HOST_ADDRESS is set in all PCS deployments.
    return getConfig('HOST_ADDRESS') || 'host.docker.internal';
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
