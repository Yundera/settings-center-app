import { execOnTarget, MigrationKeyPair, shq } from '../MigrationSSH';

/**
 * After online rsync completes, pre-warm the target's image cache so the
 * cutover window stays small. Iterates every compose file rsynced under
 * /DATA/AppData and runs `docker compose pull` on each — that resolves and
 * pulls *all* services' images in one shot per stack, including the
 * yundera system stack alongside the user apps. With every image already
 * local, `docker compose up -d` on the target's self-check and
 * `start_user_apps` is reduced to container creation, which is fast and
 * doesn't depend on registry availability.
 *
 * Docker bootstrap: a migration target is a bare-Ubuntu VPS — the migration
 * sudoer is created by the orchestrator (MigrationTargetBootstrap.ts) but
 * nothing else is installed yet. The rsynced template ships the
 * ensure-docker-installed.sh self-check, which is the canonical way to get
 * docker + the compose plugin on a Yundera host. We invoke that here when
 * `command -v docker` fails on the first probe; on a second pass docker is
 * present and we skip straight to pulling. Without this, the step would
 * silently no-op on every migration (the previous behaviour) and all pulls
 * would land inside the cutover window.
 *
 * Result returns the list of compose files successfully pulled — callers
 * use length for the step message.
 */

const DOCKER_INSTALL_SCRIPT =
    '/DATA/AppData/casaos/apps/yundera/scripts/self-check/ensure-docker-installed.sh';

export interface DockerPullResult {
    composeFilesPulled: string[];
    /** True if docker was missing and we installed it as part of this step. */
    installedDocker: boolean;
    /** Compose files we found but failed to pull (logged, not fatal). */
    failedFiles: string[];
}

export async function pullImagesOnTarget(
    keypair: MigrationKeyPair,
    target: string
): Promise<DockerPullResult> {
    let installedDocker = false;

    // 1. Ensure docker + the compose plugin are installed on the target.
    //    On a bare migration target this is the first time docker shows up.
    try {
        await execOnTarget(keypair, target, `command -v docker >/dev/null`);
    } catch {
        try {
            await execOnTarget(keypair, target, `bash ${shq(DOCKER_INSTALL_SCRIPT)}`, {
                sudo: true,
                timeout: 10 * 60 * 1000,
            });
            installedDocker = true;
        } catch (err) {
            // If we can't install docker, the migration is going to fail in
            // target_self_check anyway. Fail loudly here so the operator sees
            // the actual cause instead of a silent skip.
            const errorMsg = err instanceof Error ? err.message : String(err);
            throw new Error(`Failed to install docker on target: ${errorMsg}`);
        }
    }

    // 2. Enumerate every compose file rsynced under /DATA/AppData (yundera
    //    system stack + user apps). yundera lives at
    //    /DATA/AppData/casaos/apps/yundera; user apps at
    //    /DATA/AppData/casaos/apps/<name>. -maxdepth 4 covers both.
    const findCmd =
        `find /DATA/AppData -maxdepth 4 -type f ` +
        `\\( -name 'docker-compose.yml' -o -name 'compose.yml' -o -name 'docker-compose.yaml' \\) 2>/dev/null`;
    const findOut = await execOnTarget(keypair, target, findCmd, { sudo: true });
    const composeFiles = findOut.stdout.split('\n').map(l => l.trim()).filter(Boolean);

    if (composeFiles.length === 0) {
        return { composeFilesPulled: [], installedDocker, failedFiles: [] };
    }

    // 3. Pull each compose stack. `docker compose pull` walks every service
    //    in the file and pulls its image — one command per stack instead of
    //    per-image, which means yq/regex parsing isn't needed and we honour
    //    whatever pull-policy / platform pins the compose itself declares.
    //    Failures don't abort the migration — ensure-user-compose-pulled.sh
    //    on the target's self-check will retry with backoff during the
    //    bring-up phase. But every successful pull here shrinks the cutover
    //    window, which is the whole point of this step.
    const pulled: string[] = [];
    const failed: string[] = [];
    for (const file of composeFiles) {
        try {
            await execOnTarget(
                keypair,
                target,
                `docker compose -f ${shq(file)} pull --quiet`,
                { sudo: true, timeout: 15 * 60 * 1000 },
            );
            pulled.push(file);
        } catch (err) {
            console.warn(`[Migration] docker compose pull ${file} failed (continuing):`, err);
            failed.push(file);
        }
    }

    return { composeFilesPulled: pulled, installedDocker, failedFiles: failed };
}
