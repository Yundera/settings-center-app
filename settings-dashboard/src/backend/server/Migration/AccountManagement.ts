import crypto from 'crypto';
import { executeHostCommand } from '@/backend/cmd/HostExecutor';
import { getConfig } from '@/configuration/getConfigBackend';
import { shq } from './MigrationSSH';

/**
 * Manages the dedicated `migration` Linux account on this PCS host.
 *
 * The account is a password-login sudoer (NOPASSWD via /etc/sudoers.d/99-migration)
 * meant to be used once when this PCS becomes a migration source. Operator
 * enables it from the UI, copies the credentials, and starts a migration on
 * the destination PCS. After migration completes, the operator disables it
 * (which deletes the user entirely — no key, no home, no traces).
 *
 * Why password login (not SSH key): the destination's existing migration flow
 * already takes a host/user/password and does its own ed25519 keypair
 * provisioning on top (see steps/pushKey.ts). Adding key-based prep here
 * would duplicate that and hand a key off through the UI, which is a worse
 * UX than copying a one-time password.
 */

export const MIGRATION_USER = 'migration';
const SUDOERS_FILE = `/etc/sudoers.d/99-${MIGRATION_USER}`;

export type MigrationAccountState = 'absent' | 'enabled';

export interface EnableResult {
    user: string;
    password: string;
    host: string;
}

export async function getAccountState(): Promise<MigrationAccountState> {
    const out = await executeHostCommand(
        `id ${shq(MIGRATION_USER)} >/dev/null 2>&1 && echo EXISTS || echo ABSENT`
    );
    return out.stdout.includes('EXISTS') ? 'enabled' : 'absent';
}

export async function enableAccount(): Promise<EnableResult> {
    const password = generatePassword(20);

    // Idempotent: create user if missing, (re)set password, (re)install sudoers
    // drop-in. usermod -U is a no-op if already unlocked.
    const script = `
set -e
MIG_USER="$1"
NEW_PWD="$2"
SUDOERS="$3"

if ! id "$MIG_USER" >/dev/null 2>&1; then
  useradd -m -s /bin/bash "$MIG_USER"
fi

echo "$MIG_USER:$NEW_PWD" | chpasswd

echo "$MIG_USER ALL=(ALL) NOPASSWD:ALL" > "$SUDOERS"
chmod 440 "$SUDOERS"

usermod -U "$MIG_USER" 2>/dev/null || true

echo OK
`.trim();

    const encoded = Buffer.from(script, 'utf8').toString('base64');
    // useradd / chpasswd / writing /etc/sudoers.d need root; the SSH session
    // is the `admin` sudoer so wrap the script execution in sudo.
    const cmd = `echo ${encoded} | base64 -d | sudo -n bash -s -- ${shq(MIGRATION_USER)} ${shq(password)} ${shq(SUDOERS_FILE)}`;
    const result = await executeHostCommand(cmd);
    if (!result.stdout.includes('OK')) {
        throw new Error(`Failed to enable migration account: ${result.stdout}\n${result.stderr}`);
    }

    return {
        user: MIGRATION_USER,
        password,
        host: getConfig('PUBLIC_IP') || '',
    };
}

export async function disableAccount(): Promise<void> {
    // Best-effort, idempotent: remove sudoers drop-in then userdel -rf.
    const script = `
MIG_USER="$1"
SUDOERS="$2"
rm -f "$SUDOERS"
userdel -rf "$MIG_USER" 2>/dev/null || true
echo OK
`.trim();

    const encoded = Buffer.from(script, 'utf8').toString('base64');
    const cmd = `echo ${encoded} | base64 -d | sudo -n bash -s -- ${shq(MIGRATION_USER)} ${shq(SUDOERS_FILE)}`;
    await executeHostCommand(cmd);
}

function generatePassword(length: number): string {
    // Alphanumeric, no ambiguous chars (0/O, 1/l/I) — safe to read off-screen
    // and paste through web forms without symbol-escaping concerns.
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    const buf = crypto.randomBytes(length);
    let out = '';
    for (let i = 0; i < length; i++) {
        out += chars[buf[i] % chars.length];
    }
    return out;
}
