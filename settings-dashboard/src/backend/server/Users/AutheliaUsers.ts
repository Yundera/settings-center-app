import path from 'path';
import {executeHostCommand} from '@/backend/cmd/HostExecutor';
import {getConfig} from '@/configuration/getConfigBackend';
import {shq} from '@/backend/server/Migration/MigrationSSH';

/**
 * Local-account management for the PCS.
 *
 * Every mutation goes through `scripts/tools/authelia-user-manager.sh` on the
 * host rather than editing users_database.yml from here. That file is 0600 and
 * root-owned, Authelia rewrites it itself on password change, and the script's
 * flock is only meaningful on the host where the file lives. Same reasoning that
 * put env mutation behind env-file-manager.sh (see default-app.ts).
 *
 * The script prints JSON on stdout and diagnostics on stderr, exiting non-zero
 * on refusal — which LocalExecutor turns into a rejection carrying the stderr
 * text, so its guard messages ("refusing to delete the last member of
 * 'admins'…") reach the caller intact.
 */

export interface AutheliaUser {
    username: string;
    displayname: string;
    email: string;
    groups: string[];
}

export interface GeneratedCredential {
    username: string;
    /** Plaintext, minted by the script. Shown once and never retrievable again. */
    password: string;
}

export const ADMIN_GROUP = 'admins';
const USER_GROUP = 'users';

/**
 * The seeded operator account. Mirrors PROTECTED_USER in
 * scripts/tools/authelia-user-manager.sh, which is the enforcing copy — this one
 * exists so routes can answer with a 400 instead of letting the script fail and
 * surfacing a client error as a 500.
 */
export const PROTECTED_USER = 'admin';

// Mirrors validate_username in authelia-user-manager.sh. Duplicated rather than
// delegated so a bad value fails here with a 400 instead of a shell round-trip.
const USERNAME_RE = /^[a-z_][a-z0-9_-]{0,31}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_DISPLAYNAME = 64;

function scriptPath(): string {
    const composeFolder = getConfig('COMPOSE_FOLDER_PATH') || '/DATA/AppData/casaos/apps/yundera/';
    return path.join(composeFolder, 'scripts/tools/authelia-user-manager.sh');
}

/**
 * Run a subcommand and parse its JSON stdout.
 *
 * Arguments are shq()-quoted. executeHostCommand base64-encodes the whole
 * command for transport, so nothing is interpreted locally — but the decoded
 * string is still run by bash on the host, so quoting each argument is what
 * keeps a display name like `a'; rm -rf /` inert.
 */
async function run<T>(args: string[]): Promise<T> {
    const cmd = `sudo -n ${shq(scriptPath())} ${args.map(shq).join(' ')}`;
    const {stdout} = await executeHostCommand(cmd);
    const text = stdout.trim();
    if (!text) {
        throw new Error('authelia-user-manager.sh returned no output');
    }
    try {
        return JSON.parse(text) as T;
    } catch {
        throw new Error(`Unparseable output from authelia-user-manager.sh: ${text.slice(0, 200)}`);
    }
}

export function validateUsername(username: string): string | null {
    if (!username) return 'Username is required';
    if (!USERNAME_RE.test(username)) {
        return 'Username must start with a lowercase letter or underscore and contain only lowercase letters, digits, "-" or "_" (max 32 characters)';
    }
    return null;
}

export function validateEmail(email: string): string | null {
    if (!email) return 'Email is required';
    if (!EMAIL_RE.test(email)) return 'Email is not a valid address';
    return null;
}

export function validateDisplayname(displayname: string): string | null {
    if (!displayname || !displayname.trim()) return 'Display name is required';
    if (displayname.length > MAX_DISPLAYNAME) return `Display name must be ${MAX_DISPLAYNAME} characters or fewer`;
    // Control characters would survive into the YAML and back out through the
    // OIDC name claim; reject rather than silently strip.
    if (/[\x00-\x1f\x7f]/.test(displayname)) return 'Display name contains control characters';
    return null;
}

export async function listUsers(): Promise<AutheliaUser[]> {
    return run<AutheliaUser[]>(['list']);
}

/**
 * Group membership is derived from a boolean rather than taken as free-form
 * input: `admins` is the only group with meaning (it becomes role=admin in the
 * dashboard session), so there is nothing to gain from letting the caller
 * invent others, and something to lose in typos.
 */
export async function addUser(opts: {
    username: string;
    displayname: string;
    email: string;
    isAdmin?: boolean;
}): Promise<GeneratedCredential> {
    const groups = opts.isAdmin ? `${ADMIN_GROUP},${USER_GROUP}` : USER_GROUP;
    return run<GeneratedCredential>(['add', opts.username, opts.displayname, opts.email, groups]);
}

export async function deleteUser(username: string): Promise<void> {
    await run<{username: string}>(['delete', username]);
}

export async function resetPassword(username: string): Promise<GeneratedCredential> {
    return run<GeneratedCredential>(['set-password', username]);
}

export async function setEmail(username: string, email: string): Promise<void> {
    await run<{username: string}>(['set-email', username, email]);
}

/**
 * Pull the script's own `ERROR: …` line out of the executor's wrapper text so
 * the UI shows "refusing to delete the last member of 'admins'" rather than
 * "Command failed with code 1: ERROR: refusing to…". Falls back to the raw
 * message when the shape is unfamiliar.
 */
export function describeUserError(error: unknown): string {
    const raw = error instanceof Error ? error.message : String(error);
    const match = raw.match(/ERROR:\s*(.+?)(?:\n|$)/);
    return match ? match[1].trim() : raw;
}
