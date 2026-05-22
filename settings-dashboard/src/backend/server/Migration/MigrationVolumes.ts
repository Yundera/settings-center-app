import { executeHostCommand } from '@/backend/cmd/HostExecutor';
import { RsyncProgress } from './MigrationTypes';
import { execOnTarget, MigrationKeyPair, shq } from './MigrationSSH';
import { runRsync } from './steps/rsync';

/**
 * Docker named-volume migration.
 *
 * The `/DATA` rsync (steps/rsync.ts) copies everything under /DATA but Docker
 * named volumes live under /var/lib/docker/volumes/<name>/ — outside /DATA, and
 * the `-x` (one-file-system) rsync flag would skip them anyway. An app that
 * keeps state in a named volume (databases: postgres/mariadb run their data dir
 * in one) would otherwise land on the destination with an empty volume — silent
 * data loss. These helpers copy every user-app named volume alongside /DATA.
 *
 * Why a plain host-path rsync is correct here: the Yundera fleet runs ROOTFUL
 * Docker with the default data-root and no userns-remap, so a file's on-disk
 * UID equals its in-container UID (no namespace remapping). rsync --numeric-ids
 * therefore reproduces ownership exactly — no in-container `docker run ... tar`
 * copy is needed. `assertRootfulDocker()` (called from preflight) is the loud
 * guard that fails the migration if that assumption ever stops holding.
 *
 * The `yundera` system stack is excluded — the target rebuilds it from scratch
 * during `target_self_check`. Non-plain-`local` volumes (NFS/CIFS/tmpfs, or any
 * `local` volume created with driver `--opt`) are skipped: byte-copying them
 * would pull a remote/ephemeral backend through and re-localize it.
 */

/** Docker's default rootful data-root volume directory. */
const DOCKER_VOLUMES_ROOT = '/var/lib/docker/volumes';

/** Compose project name of the Yundera system stack — never migrated here. */
const SYSTEM_STACK = 'yundera';

export interface AppVolume {
    /** Docker volume name, e.g. `nextcloud_db`. */
    name: string;
    /** `com.docker.compose.project` label — the owning app. */
    project: string;
}

export interface VolumeSyncOptions {
    keypair: MigrationKeyPair;
    target: string;
    /** Mirror the /DATA pass: false for the online pre-seed, true for the offline delta. */
    deleteFlag: boolean;
    onProgress: (p: RsyncProgress) => Promise<void>;
    isCancelled: () => Promise<boolean>;
}

/**
 * Verify the SOURCE Docker daemon is rootful, on the default data-root, and not
 * userns-remapped — the invariants the host-path volume copy relies on. Throws
 * a human-readable error otherwise so preflight fails loud rather than copying
 * volumes with mangled ownership.
 */
export async function assertRootfulDocker(): Promise<void> {
    const out = await executeHostCommand(
        `sudo -n docker info --format '{{.DockerRootDir}}|{{json .SecurityOptions}}'`,
    );
    const raw = out.stdout.trim();
    const sep = raw.indexOf('|');
    if (sep < 0) {
        throw new Error(`unexpected 'docker info' output: ${raw.slice(0, 200)}`);
    }
    const rootDir = raw.slice(0, sep).trim();
    const securityOptions = raw.slice(sep + 1);

    if (rootDir !== '/var/lib/docker') {
        throw new Error(
            `Docker data-root is ${rootDir}, expected /var/lib/docker — ` +
            `named-volume migration assumes the default data-root.`,
        );
    }
    if (/rootless/i.test(securityOptions)) {
        throw new Error(
            `Docker is running rootless — named-volume migration requires rootful ` +
            `Docker (a host-path volume copy would land the wrong file ownership).`,
        );
    }
    if (/name=userns/i.test(securityOptions)) {
        throw new Error(
            `Docker has userns-remap enabled — named-volume migration requires it ` +
            `disabled (a host-path volume copy would land the wrong file ownership).`,
        );
    }
}

/**
 * Enumerate the named volumes to migrate: every Docker volume that
 *   - carries a `com.docker.compose.project` label (created by an app's
 *     compose stack) whose project is not the `yundera` system stack, and
 *   - uses the plain `local` driver with no driver options.
 *
 * Runs on the SOURCE host (which always has Docker). Two docker calls total:
 * `volume ls -q` for names, then a single batched `volume inspect`.
 */
export async function collectAppVolumes(): Promise<AppVolume[]> {
    const lsOut = await executeHostCommand(`sudo -n docker volume ls -q`);
    const names = lsOut.stdout.split('\n').map(s => s.trim()).filter(Boolean);
    if (names.length === 0) return [];

    const inspectOut = await executeHostCommand(
        `sudo -n docker volume inspect ${names.map(shq).join(' ')}`,
    );
    let parsed: unknown;
    try {
        parsed = JSON.parse(inspectOut.stdout);
    } catch (err) {
        throw new Error(
            `could not parse 'docker volume inspect' output: ` +
            `${err instanceof Error ? err.message : String(err)}`,
        );
    }
    if (!Array.isArray(parsed)) return [];

    const result: AppVolume[] = [];
    for (const v of parsed as Array<Record<string, any>>) {
        if (typeof v?.Name !== 'string') continue;
        const project = v?.Labels?.['com.docker.compose.project'];
        if (typeof project !== 'string' || project === '' || project === SYSTEM_STACK) continue;
        // Plain `local` volumes only — skip NFS/CIFS/tmpfs and driver plugins.
        if (v?.Driver !== 'local') continue;
        if (v?.Options && Object.keys(v.Options).length > 0) continue;
        result.push({ name: v.Name, project });
    }
    return result;
}

/**
 * Total on-disk size (bytes) of the given volumes on the SOURCE host. Used by
 * preflight to add the named-volume footprint to the target free-space check.
 */
export async function sizeAppVolumes(vols: AppVolume[]): Promise<number> {
    if (vols.length === 0) return 0;
    const paths = vols.map(v => shq(`${DOCKER_VOLUMES_ROOT}/${v.name}`)).join(' ');
    // `|| true` so a vanished volume dir doesn't fail the whole command.
    const out = await executeHostCommand(`sudo -n du -sb ${paths} 2>/dev/null || true`);
    let total = 0;
    for (const line of out.stdout.split('\n')) {
        const m = line.trim().match(/^(\d+)\s/);
        if (m) total += parseInt(m[1], 10);
    }
    return total;
}

/**
 * Copy the source's user-app named volumes to the target, one rsync per volume.
 *
 * Reuses runRsync — same `sudo rsync` on the source host, same
 * `--rsync-path='sudo -n rsync'` writing the target as root, same
 * `-aHAXS --numeric-ids` flags. The path pair is
 * /var/lib/docker/volumes/<name>/ on both ends.
 *
 * Called twice, mirroring the /DATA passes: once in `online_rsync` (pre-seed,
 * apps live) and once in `offline_rsync` (delta with --delete, apps stopped so
 * the copy is consistent). The online pass runs before the target has Docker —
 * that is fine: it writes plain directories under /var/lib/docker/volumes/,
 * and dockerd's local volume driver discovers them from the filesystem when
 * `docker_pull` later installs and first starts it.
 *
 * Returns the volume list so the caller can describe it in the step message
 * and hand it to registerVolumesOnTarget.
 */
export async function syncAppVolumes(opts: VolumeSyncOptions): Promise<AppVolume[]> {
    const volumes = await collectAppVolumes();
    if (volumes.length === 0) return [];

    // The target may still be bare Ubuntu with no /var/lib/docker yet (online
    // pass runs before docker_pull installs Docker) — create the parent so
    // rsync can land each <name>/ directory under it.
    await execOnTarget(
        opts.keypair,
        opts.target,
        `mkdir -p ${shq(DOCKER_VOLUMES_ROOT)}`,
        { sudo: true },
    );

    for (const v of volumes) {
        if (await opts.isCancelled()) throw new Error('Cancelled');
        const path = `${DOCKER_VOLUMES_ROOT}/${v.name}/`;
        await runRsync({
            keypair: opts.keypair,
            target: opts.target,
            deleteFlag: opts.deleteFlag,
            onProgress: opts.onProgress,
            isCancelled: opts.isCancelled,
            localPath: path,
            remotePath: path,
        });
    }
    return volumes;
}

/**
 * Register the migrated volumes with the target's running Docker daemon via
 * `docker volume create` (idempotent — for a volume whose directory already
 * holds rsynced data it is a no-op that adopts the directory without wiping
 * it). Run after `docker_pull` has installed Docker on the target, so the
 * daemon definitely knows every volume before `start_user_apps` runs
 * `docker compose up`.
 */
export async function registerVolumesOnTarget(
    keypair: MigrationKeyPair,
    target: string,
    vols: AppVolume[],
): Promise<void> {
    for (const v of vols) {
        await execOnTarget(keypair, target, `docker volume create ${shq(v.name)}`, { sudo: true });
    }
}
