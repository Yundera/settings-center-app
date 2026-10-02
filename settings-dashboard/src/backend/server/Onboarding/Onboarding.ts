import {executeHostCommand} from '@/backend/cmd/HostExecutor';
import {yndScriptsPrelude} from '@/configuration/yndRoot';
import {shq} from '@/backend/cmd/shq';

/**
 * First-run onboarding.
 *
 * Everything here is a thin wrapper around `scripts/tools/onboarding.sh` on the
 * host. The dashboard deliberately owns none of the logic: what "onboarding"
 * means is the script's business, and a deployment replaces it wholesale by
 * dropping its own at /DATA/AppData/yundera/onboarding.d/onboarding.sh. That is
 * the entire reason this indirection exists — see doc/pcs-onboarding.md in
 * template-root.
 *
 * Stdout is the script's JSON answer; errors carry its `ERROR: …` line.
 */

export interface OnboardingStatus {
    /**
     * Is there a usable local credential? DERIVED on every call from
     * users_database.yml — never cached, never inferred from the marker. A
     * restored backup or a migrated PCS can carry a "completed" marker onto a
     * box whose account is unclaimed; trusting the marker there would hide the
     * wizard from an owner who has no other way to make a credential.
     */
    claimed: boolean;
    /** Has the wizard been through once? Marker file. Cosmetic. */
    completed: boolean;
    /** The owner's chosen login name, when there is one. */
    username: string;
}

export interface OnboardingResetResult {
    /** Always false — the script fails rather than returning a claimed box. */
    claimed: boolean;
    completed: boolean;
    username: string;
    /** Path of the timestamped users_database.yml copy the script kept. */
    backup: string;
}

export interface OnboardingResult {
    username: string;
    claimed: boolean;
    completed: boolean;
    /** Present only when the password was generated host-side. Shown ONCE. */
    password?: string;
}

// Mirrors validate_username in authelia-user-manager.sh, which is the enforcing
// copy. Duplicated so a bad value fails with a 400 instead of a shell round-trip.
const USERNAME_RE = /^[a-z_][a-z0-9_-]{0,31}$/;
const MIN_PASSWORD = 8;
const MAX_DISPLAYNAME = 64;

// Host-resolved, not shq()-quoted — see scriptRef() in Features.ts and
// yndScriptsPrelude() in yndRoot.ts.
const SCRIPT_REF = '"$YND_SCRIPTS/tools/onboarding.sh"';

async function run<T>(args: string[], opts?: {env?: Record<string, string>; stdin?: string}): Promise<T> {
    // Non-secret inputs ride in the environment; the password rides in stdin.
    // Anything placed in this string is base64'd into an ssh argv and is
    // therefore readable from `ps` — see HostExecutor.
    const env = Object.entries(opts?.env || {})
        .map(([k, v]) => `${k}=${shq(v)}`)
        .join(' ');
    const cmd = `${yndScriptsPrelude()}sudo -n ${env ? `env ${env} ` : ''}${SCRIPT_REF} ${args.map(shq).join(' ')}`;

    const {stdout} = await executeHostCommand(cmd, {stdin: opts?.stdin});
    const text = stdout.trim();
    if (!text) {
        throw new Error('onboarding.sh returned no output');
    }
    try {
        return JSON.parse(text) as T;
    } catch {
        throw new Error(`Unparseable output from onboarding.sh: ${text.slice(0, 200)}`);
    }
}

export function validateUsername(username: string): string | null {
    if (!username) return 'Username is required';
    if (!USERNAME_RE.test(username)) {
        return 'Username must start with a lowercase letter or underscore and contain only lowercase letters, digits, "-" or "_" (max 32 characters)';
    }
    return null;
}

export function validatePassword(password: string): string | null {
    if (!password) return 'Password is required';
    if (password.length < MIN_PASSWORD) return `Password must be at least ${MIN_PASSWORD} characters`;
    // The host script reads the secret with a single `read`, so anything after a
    // newline would be silently dropped — the user would set one password and be
    // able to log in with a shorter one. Reject rather than truncate.
    if (/[\r\n]/.test(password)) return 'Password must not contain line breaks';
    return null;
}

export function validateDisplayname(displayname: string): string | null {
    if (!displayname || !displayname.trim()) return 'Display name is required';
    if (displayname.length > MAX_DISPLAYNAME) return `Display name must be ${MAX_DISPLAYNAME} characters or fewer`;
    if (/[\x00-\x1f\x7f]/.test(displayname)) return 'Display name contains control characters';
    return null;
}

export async function getOnboardingStatus(): Promise<OnboardingStatus> {
    return run<OnboardingStatus>(['status']);
}

export async function runOnboarding(opts: {
    username: string;
    displayname: string;
    password?: string;
    generate?: boolean;
}): Promise<OnboardingResult> {
    const env: Record<string, string> = {
        ONBOARDING_USERNAME: opts.username,
        ONBOARDING_DISPLAYNAME: opts.displayname,
    };
    if (opts.generate) {
        env.ONBOARDING_GENERATE = '1';
    }
    return run<OnboardingResult>(['run'], {
        env,
        // Newline-terminated: the script reads one line with `read`.
        stdin: opts.generate ? undefined : `${opts.password ?? ''}\n`,
    });
}

export async function markOnboardingCompleted(): Promise<void> {
    await run<{completed: boolean}>(['mark-completed']);
}

/**
 * Unclaim the box so the first-start wizard replays ("Re-run onboarding").
 *
 * A self-lockout operation: it disables every local account and ensure-dex.sh
 * withdraws the Local Account connector, so afterwards Yundera Login is the only
 * way back to the wizard. The route refuses when that connector is off, spares
 * the caller's gate session and revokes every other one; the UI makes the
 * operator type `reset` first. The script keeps a timestamped `*.reset-backup`
 * copy of users_database.yml — the only copy of the previous password hashes —
 * and returns its path.
 */
export async function resetOnboarding(): Promise<OnboardingResetResult> {
    return run<OnboardingResetResult>(['reset', '--confirm']);
}

/**
 * Pull the script's own `ERROR: …` line out of the executor's wrapper text so
 * the UI shows the real reason rather than "Command failed with code 1: ERROR: …".
 */
export function describeOnboardingError(error: unknown): string {
    const raw = error instanceof Error ? error.message : String(error);
    const match = raw.match(/ERROR:\s*(.+?)(?:\n|$)/);
    return match ? match[1].trim() : raw;
}
