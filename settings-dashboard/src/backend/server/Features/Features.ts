import path from 'path';
import {executeHostCommand} from '@/backend/cmd/HostExecutor';
import {yndRoot} from '@/configuration/yndRoot';
import {shq} from '@/backend/server/Migration/MigrationSSH';

/**
 * The optional parts of a Yundera PCS — the things the operator runs *for* the
 * owner rather than on the box — and the switches that turn them off.
 *
 * Everything here is a thin wrapper around `scripts/tools/feature-*.sh` on the
 * host, the same way Onboarding.ts wraps onboarding.sh. The dashboard owns none
 * of the logic: each script decides where its flag lives, how "off" is spelled,
 * and what applying it actually means. That indirection is deliberate — a
 * deployment can replace one script without this file knowing, and the flags it
 * writes are honoured by self-check scripts that run whether or not this app is
 * installed. See template-root's doc/onboarding-options.md.
 *
 * Adding a fourth feature is one line in FEATURE_SCRIPTS plus one descriptor in
 * FeaturesPanel.tsx.
 *
 * WHY sudo. The scripts write .pcs.env (owned by `pcs`), remove keys from
 * admin's authorized_keys, and re-render Dex. `admin` has NOPASSWD:ALL from
 * ensure-admin-user.sh, so no per-script sudoers rule is needed — but they must
 * be invoked under `sudo -n`, never bare.
 *
 * Same stdout-is-JSON contract as Onboarding.ts / AutheliaUsers.ts.
 */

export const FEATURE_SCRIPTS = {
    'yundera-login': 'feature-yundera-login.sh',
    'support-key': 'feature-support-key.sh',
    'platform-updates': 'feature-platform-updates.sh',
} as const;

export type FeatureId = keyof typeof FEATURE_SCRIPTS;

export const FEATURE_IDS = Object.keys(FEATURE_SCRIPTS) as FeatureId[];

export function isFeatureId(value: unknown): value is FeatureId {
    return typeof value === 'string' && Object.prototype.hasOwnProperty.call(FEATURE_SCRIPTS, value);
}

export interface FeatureState {
    id: FeatureId;
    /** Null when the state could not be read — see `error`. */
    enabled: boolean | null;
    /** The script's own reason, when reading it failed. */
    error?: string;
}

function scriptPath(id: FeatureId): string {
    const composeFolder = yndRoot();
    return path.join(composeFolder, 'scripts/tools', FEATURE_SCRIPTS[id]);
}

async function run(id: FeatureId, verb: 'status' | 'enable' | 'disable'): Promise<boolean> {
    const {stdout} = await executeHostCommand(`sudo -n ${shq(scriptPath(id))} ${verb}`);
    const text = stdout.trim();
    if (!text) {
        throw new Error(`${FEATURE_SCRIPTS[id]} returned no output`);
    }
    let parsed: {id?: string; enabled?: boolean};
    try {
        parsed = JSON.parse(text);
    } catch {
        throw new Error(`Unparseable output from ${FEATURE_SCRIPTS[id]}: ${text.slice(0, 200)}`);
    }
    if (typeof parsed.enabled !== 'boolean') {
        throw new Error(`${FEATURE_SCRIPTS[id]} returned no "enabled" field`);
    }
    return parsed.enabled;
}

export async function getFeature(id: FeatureId): Promise<boolean> {
    return run(id, 'status');
}

/**
 * Reads all three at once.
 *
 * allSettled, not all: a box on an older template simply does not have one of
 * these scripts yet, and one missing file must degrade that row rather than
 * blank the page.
 */
export async function getFeatures(): Promise<FeatureState[]> {
    const results = await Promise.allSettled(FEATURE_IDS.map(id => run(id, 'status')));
    return FEATURE_IDS.map((id, i) => {
        const result = results[i];
        return result.status === 'fulfilled'
            ? {id, enabled: result.value}
            : {id, enabled: null, error: describeFeatureError(result.reason)};
    });
}

export async function setFeature(id: FeatureId, enabled: boolean): Promise<FeatureState> {
    return {id, enabled: await run(id, enabled ? 'enable' : 'disable')};
}

/**
 * Pull the script's own `ERROR: …` line out of the executor's wrapper text so
 * the UI shows the real reason rather than "Command failed with code 1: ERROR: …".
 *
 * Four lines duplicated from describeOnboardingError in Onboarding.ts. Kept
 * local rather than importing an onboarding-named helper into an unrelated
 * module — the contract, not the code, is what these two share.
 */
export function describeFeatureError(error: unknown): string {
    const raw = error instanceof Error ? error.message : String(error);
    const match = raw.match(/ERROR:\s*(.+?)(?:\n|$)/);
    return match ? match[1].trim() : raw;
}
