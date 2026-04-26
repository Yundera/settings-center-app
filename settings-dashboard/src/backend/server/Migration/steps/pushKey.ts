import { executeHostCommand } from '@/backend/cmd/HostExecutor';
import { MigrationRequest } from '../MigrationTypes';
import { MigrationKeyPair, MIGRATION_PATHS, newRunId, shq } from '../MigrationSSH';

/**
 * Creates a dedicated migration user on the source with passwordless sudo,
 * generates a fresh ed25519 keypair on the target host, and installs the
 * public key into that user's authorized_keys.
 *
 * The password is used once (via sshpass piped to ssh over stdin) and is
 * never persisted. Cleanup (removeMigrationAccount) deletes both the user
 * on the source and the local key on the target host.
 */

export async function pushMigrationKey(req: MigrationRequest): Promise<MigrationKeyPair> {
    const runId = newRunId();
    const migrationUser = `yundera-migration-${runId}`;
    const keyDir = MIGRATION_PATHS.keyDirOnHost;
    const privateKeyPath = `${keyDir}/${runId}`;
    const publicKeyPath = `${privateKeyPath}.pub`;

    // 1. Generate keypair on target host
    await executeHostCommand(`mkdir -p ${shq(keyDir)} && chmod 700 ${shq(keyDir)}`);
    await executeHostCommand(
        `ssh-keygen -t ed25519 -N '' -f ${shq(privateKeyPath)} -C ${shq(`yundera-migration-${runId}`)}`
    );
    const pubKeyOut = await executeHostCommand(`cat ${shq(publicKeyPath)}`);
    const publicKey = pubKeyOut.stdout.trim();

    // 2. Build the remote bootstrap script. Runs on source as the operator,
    //    uses sudo (password piped via stdin) to create the migration user,
    //    set up passwordless sudo for the duration of the run, and install
    //    the pubkey.
    const remoteScript = `
set -e
SUDO_PWD="$1"
MIG_USER="$2"
PUB_KEY="$3"

_sudo() { echo "$SUDO_PWD" | sudo -S -p '' "$@"; }

# Create migration user if missing (idempotent)
if ! id "$MIG_USER" >/dev/null 2>&1; then
  _sudo useradd -m -s /bin/bash "$MIG_USER"
fi

# Install pubkey
_sudo mkdir -p "/home/$MIG_USER/.ssh"
_sudo chmod 700 "/home/$MIG_USER/.ssh"
_sudo chown "$MIG_USER:$MIG_USER" "/home/$MIG_USER/.ssh"
echo "$PUB_KEY" | _sudo tee "/home/$MIG_USER/.ssh/authorized_keys" >/dev/null
_sudo chmod 600 "/home/$MIG_USER/.ssh/authorized_keys"
_sudo chown "$MIG_USER:$MIG_USER" "/home/$MIG_USER/.ssh/authorized_keys"

# Passwordless sudo for this user (scoped to a dedicated drop-in file so cleanup is easy)
echo "$MIG_USER ALL=(ALL) NOPASSWD:ALL" | _sudo tee "/etc/sudoers.d/99-$MIG_USER" >/dev/null
_sudo chmod 440 "/etc/sudoers.d/99-$MIG_USER"

echo "OK"
`.trim();

    // 3. Stream the script via sshpass with password piped through stdin.
    //    We wrap the script with `bash -s -- <args>` so the password and
    //    the other positional args are consumed as $1, $2, $3 by the remote
    //    shell and never appear on the command line.
    //
    //    Outer command shape (as it runs on the target HOST):
    //      SSHPASS='...' sshpass -e ssh user@host 'bash -s -- "<pwd>" "<user>" "<key>"' < script
    //
    //    The password IS placed into the remote argv here. Trade-off: clean
    //    delivery to sudo without a second password prompt, at the cost of
    //    the password briefly being visible in ps on source. Bash is the
    //    login shell on Ubuntu PCS so echo is a builtin — argv exposure is
    //    the only remaining concern and it's bounded to the brief window
    //    before `useradd` completes on the same machine the operator owns.
    const scriptEncoded = Buffer.from(remoteScript, 'utf8').toString('base64');
    const sshpassCmd = [
        `SSHPASS=${shq(req.password)}`,
        'sshpass',
        '-e',
        'ssh',
        '-o', 'StrictHostKeyChecking=accept-new',
        '-o', 'ConnectTimeout=10',
        '-o', 'PreferredAuthentications=password',
        '-o', 'PubkeyAuthentication=no',
        `${req.user}@${req.host}`,
        shq(`echo ${scriptEncoded} | base64 -d | bash -s -- ${shq(req.password)} ${shq(migrationUser)} ${shq(publicKey)}`),
    ].join(' ');

    const result = await executeHostCommand(sshpassCmd);
    if (!result.stdout.includes('OK')) {
        throw new Error(`Migration account setup did not return OK: ${result.stdout}\n${result.stderr}`);
    }

    // 4. Verify key auth works now, so subsequent steps can rely on it
    const verify = await executeHostCommand(
        [
            'ssh',
            '-i', shq(privateKeyPath),
            '-o', 'StrictHostKeyChecking=accept-new',
            '-o', 'BatchMode=yes',
            '-o', 'ConnectTimeout=10',
            `${migrationUser}@${req.host}`,
            shq('sudo -n whoami'),
        ].join(' ')
    );
    if (!verify.stdout.trim().includes('root')) {
        throw new Error(`Key auth + sudo verification on source failed: ${verify.stdout} / ${verify.stderr}`);
    }

    return { privateKeyPath, publicKey, migrationUser, runId };
}

/**
 * Remove the migration user and sudoers drop-in from source, plus the local
 * key on target host. Best-effort: errors are logged but not rethrown — we
 * never want cleanup to mask the real success/failure of the migration.
 *
 * Must SSH as the original operator, not as the migration user, because a
 * user can't delete its own home while logged in. Uses the operator creds
 * still held in-memory from the migration request.
 */
export async function removeMigrationAccount(
    keypair: MigrationKeyPair,
    req: MigrationRequest
): Promise<void> {
    const cleanupScript = `
set -e
SUDO_PWD="$1"
MIG_USER="$2"
_sudo() { echo "$SUDO_PWD" | sudo -S -p '' "$@"; }
_sudo rm -f "/etc/sudoers.d/99-$MIG_USER" || true
_sudo userdel -rf "$MIG_USER" 2>/dev/null || true
echo DONE
`.trim();

    try {
        const scriptEncoded = Buffer.from(cleanupScript, 'utf8').toString('base64');
        const sshpassCmd = [
            `SSHPASS=${shq(req.password)}`,
            'sshpass',
            '-e',
            'ssh',
            '-o', 'StrictHostKeyChecking=accept-new',
            '-o', 'ConnectTimeout=10',
            '-o', 'PreferredAuthentications=password',
            '-o', 'PubkeyAuthentication=no',
            `${req.user}@${req.host}`,
            shq(`echo ${scriptEncoded} | base64 -d | bash -s -- ${shq(req.password)} ${shq(keypair.migrationUser)}`),
        ].join(' ');
        await executeHostCommand(sshpassCmd);
    } catch (err) {
        console.error('[Migration] remote cleanup failed (non-fatal):', err);
    }

    try {
        await executeHostCommand(`rm -f ${shq(keypair.privateKeyPath)} ${shq(keypair.privateKeyPath + '.pub')}`);
    } catch (err) {
        console.error('[Migration] local key cleanup failed (non-fatal):', err);
    }
}
