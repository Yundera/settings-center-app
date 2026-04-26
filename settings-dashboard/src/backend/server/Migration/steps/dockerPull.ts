import { executeHostCommand } from '@/backend/cmd/HostExecutor';
import { shq } from '../MigrationSSH';

/**
 * After online rsync completes, walk the copied /DATA/AppData compose files
 * on the target host, extract image references, and docker-pull each on
 * target. This pre-warms the image cache so offline `docker compose up`
 * later is fast and has no surprise registry failures.
 *
 * We shell out to `yq` which is already installed on every PCS via
 * ensure-common-tools-installed.sh. It reads docker-compose.yml files and
 * prints `.services[].image` values.
 */

export async function pullImagesOnTarget(): Promise<string[]> {
    // Find all docker-compose.yml files under the copied AppData tree,
    // extract the unique set of image references, pull each.
    const findCmd = `find /DATA/AppData -maxdepth 4 -type f \\( -name 'docker-compose.yml' -o -name 'compose.yml' -o -name 'docker-compose.yaml' \\) 2>/dev/null`;
    const findOut = await executeHostCommand(findCmd);
    const composeFiles = findOut.stdout.split('\n').map(l => l.trim()).filter(Boolean);

    if (composeFiles.length === 0) {
        return [];
    }

    // Extract images via yq. Ignore errors on individual files (a malformed
    // compose file shouldn't block migration) — we'll re-hit them during
    // `docker compose up` on the self-check step.
    const images = new Set<string>();
    for (const file of composeFiles) {
        try {
            const out = await executeHostCommand(`yq -r '.services[] | .image' ${shq(file)} 2>/dev/null`);
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
    // A failure on one image is logged and migration continues; `docker compose up`
    // will surface any truly unavailable images on the self-check step.
    for (const image of imageList) {
        try {
            await executeHostCommand(`docker pull ${shq(image)}`, { timeout: 10 * 60 * 1000 });
        } catch (err) {
            console.warn(`[Migration] docker pull ${image} failed (continuing):`, err);
        }
    }

    return imageList;
}
