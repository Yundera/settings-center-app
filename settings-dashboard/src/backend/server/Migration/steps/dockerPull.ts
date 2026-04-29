import { execOnTarget, MigrationKeyPair, shq } from '../MigrationSSH';

/**
 * After online rsync completes, walk the copied /DATA/AppData compose files
 * on the TARGET, extract image references, and docker-pull each there. This
 * pre-warms the target's image cache so the final `docker compose up` (run
 * by the target's self-check) is fast and has no surprise registry failures.
 *
 * Runs over the migration SSH key. Best-effort: if `yq` or `docker` aren't
 * available on a bare-Ubuntu target, we skip this step rather than fail —
 * the target's self-check will still surface real issues at compose-up time.
 */

export async function pullImagesOnTarget(
    keypair: MigrationKeyPair,
    target: string
): Promise<string[]> {
    // Skip cleanly if docker isn't installed on target (bare-Ubuntu case).
    try {
        await execOnTarget(keypair, target, `command -v docker >/dev/null`);
    } catch {
        console.warn('[Migration] docker not installed on target, skipping pre-pull');
        return [];
    }

    const findCmd = `find /DATA/AppData -maxdepth 4 -type f \\( -name 'docker-compose.yml' -o -name 'compose.yml' -o -name 'docker-compose.yaml' \\) 2>/dev/null`;
    const findOut = await execOnTarget(keypair, target, findCmd, { sudo: true });
    const composeFiles = findOut.stdout.split('\n').map(l => l.trim()).filter(Boolean);

    if (composeFiles.length === 0) {
        return [];
    }

    // Extract images via yq. If yq isn't installed on the target, fall back
    // to a regex (good enough for `image: foo/bar:tag` lines).
    let useYq = true;
    try {
        await execOnTarget(keypair, target, `command -v yq >/dev/null`);
    } catch {
        useYq = false;
    }

    const images = new Set<string>();
    for (const file of composeFiles) {
        try {
            const cmd = useYq
                ? `yq -r '.services[] | .image' ${shq(file)} 2>/dev/null`
                : `grep -E '^\\s*image:\\s*' ${shq(file)} | sed -E 's/^\\s*image:\\s*//;s/[\"\\x27]//g' 2>/dev/null`;
            const out = await execOnTarget(keypair, target, cmd, { sudo: true });
            for (const line of out.stdout.split('\n')) {
                const img = line.trim();
                if (img && img !== 'null') images.add(img);
            }
        } catch (err) {
            console.warn(`[Migration] failed to extract images from ${file}:`, err);
        }
    }

    const imageList = Array.from(images);
    if (imageList.length === 0) return [];

    // Pull sequentially to avoid saturating the network / registry rate limits.
    // Failures are logged and migration continues — `docker compose up` on
    // the target's self-check will surface any truly unavailable images.
    for (const image of imageList) {
        try {
            await execOnTarget(keypair, target, `docker pull ${shq(image)}`, {
                sudo: true,
                timeout: 10 * 60 * 1000,
            });
        } catch (err) {
            console.warn(`[Migration] docker pull ${image} failed (continuing):`, err);
        }
    }

    return imageList;
}
