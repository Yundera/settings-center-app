import fs from 'fs/promises';
import {executeHostCommand} from '@/backend/cmd/HostExecutor';
import {yndScriptsPrelude} from '@/configuration/yndRoot';
import {IdentityBundle} from './verifyBundle';

/**
 * The host half of an identity push: check the bundle is meant for this
 * machine, write it into the env files, and let self-check apply a changed
 * domain identity to the mesh.
 *
 * Every write goes over the existing `admin` SSH path. That path depends only
 * on self-check's ensure-admin-user.sh and on the key this app regenerates at
 * every start, so a wiped box can still be repaired — no secret of its own is
 * needed (pcs-orchestrator doc/identity-push.md, goal 1).
 */

/** Addresses on the host's own interfaces. Contabo VMs carry the public IP on eth0. */
export async function hostAddresses(): Promise<Set<string>> {
    const {stdout} = await executeHostCommand(`ip -o addr show | awk '{print $4}'`, {timeout: 15_000});
    return new Set(stdout.split('\n').map(l => l.trim().split('/')[0]).filter(Boolean));
}

/**
 * Last applied `iat`, so an older bundle cannot roll the box back. Losing it
 * is harmless — the bundle's 15-minute `exp` still bounds a replay — which is
 * why it is a plain file in the app's data directory and not anything the
 * design depends on.
 */
const STATE_FILE = '/app/data/identity-state.json';

export async function lastAppliedIat(): Promise<number> {
    try {
        const v = JSON.parse(await fs.readFile(STATE_FILE, 'utf8')).lastIat;
        return typeof v === 'number' ? v : 0;
    } catch {
        return 0;
    }
}

async function recordAppliedIat(iat: number): Promise<void> {
    try {
        await fs.writeFile(STATE_FILE, JSON.stringify({lastIat: iat, appliedAt: new Date().toISOString()}));
    } catch (e) {
        console.warn('[identity] could not record the applied iat:', (e as Error)?.message ?? e);
    }
}

/**
 * Write the bundle with the template's `tools/apply-identity.sh`. Values go on
 * stdin, never on the command line (see HostExecutor's `stdin` note). Returns
 * whether PROVIDER_STR or DOMAIN changed, which the mesh has to pick up.
 */
export async function applyIdentity(bundle: IdentityBundle, iat: number): Promise<{identityChanged: boolean}> {
    const lines = (['UID', 'DOMAIN', 'EMAIL', 'DOMAIN_UID', 'USER_JWT', 'PROVIDER_STR'] as const)
        .map(k => `${k}=${bundle[k]}`)
        .join('\n') + '\n';
    const {stdout} = await executeHostCommand(
        `${yndScriptsPrelude()}sudo -n bash "$YND_SCRIPTS/tools/apply-identity.sh"`,
        {stdin: lines, timeout: 60_000},
    );
    await recordAppliedIat(iat);
    const identityChanged = /^identity-changed$/m.test(stdout);
    if (identityChanged) {
        // Same as the Self-check button: detached, and self-check's own flock
        // makes it a no-op when a run (e.g. the one that rang the doorbell) is
        // already going — that run reaches ensure-mesh-installed.sh later anyway.
        await executeHostCommand(
            `${yndScriptsPrelude()}nohup sudo -n bash "$YND_SCRIPTS/self-check.sh" > /dev/null 2>&1 < /dev/null &`,
            {timeout: 15_000},
        );
    }
    return {identityChanged};
}
