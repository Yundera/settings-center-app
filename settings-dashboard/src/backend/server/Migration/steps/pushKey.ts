import { executeHostCommand } from '@/backend/cmd/HostExecutor';
import { MigrationRequest } from '../MigrationTypes';
import { MigrationKeyPair, MIGRATION_PATHS, newRunId, shq } from '../MigrationSSH';

/**
 * Generates a fresh ed25519 keypair on the SOURCE host and installs the
 * public key into the TARGET migration user's authorized_keys.
 *
 * The migration account itself is created on the target by the target's user
 * via the target's UI (POST /api/admin/migration/account-enable), with
 * NOPASSWD sudo and a known password. Here we use that password ONCE to
 * append our pubkey to authorized_keys, then everything else runs over key
 * auth. Cleanup at the end of the migration removes our pubkey from the
 * target — the migration user itself stays so the target's user can disable
 * it manually from their UI.
 */

export async function pushMigrationKey(req: MigrationRequest): Promise<MigrationKeyPair> {
    const runId = newRunId();
    const migrationUser = req.user;
    const keyDir = MIGRATION_PATHS.keyDirOnHost;
    const privateKeyPath = `${keyDir}/${runId}`;
    const publicKeyPath = `${privateKeyPath}.pub`;

    // 1. Generate keypair on source host
    await executeHostCommand(`mkdir -p ${shq(keyDir)} && chmod 700 ${shq(keyDir)}`);
    await executeHostCommand(
        `ssh-keygen -t ed25519 -N '' -f ${shq(privateKeyPath)} -C ${shq(`yundera-migration-${runId}`)}`
    );
    const pubKeyOut = await executeHostCommand(`cat ${shq(publicKeyPath)}`);
    const publicKey = pubKeyOut.stdout.trim();

    // 2. Append pubkey to target migration user's authorized_keys (idempotent).
    //    The migration user already has a home + sudo from the target's
    //    account-enable; we only need to seed the SSH key.
    const remoteScript = `
set -e
PUB_KEY="$1"
mkdir -p "$HOME/.ssh"
chmod 700 "$HOME/.ssh"
touch "$HOME/.ssh/authorized_keys"
chmod 600 "$HOME/.ssh/authorized_keys"
grep -qF "$PUB_KEY" "$HOME/.ssh/authorized_keys" || echo "$PUB_KEY" >> "$HOME/.ssh/authorized_keys"
echo OK
`.trim();

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
        shq(`echo ${scriptEncoded} | base64 -d | bash -s -- ${shq(publicKey)}`),
    ].join(' ');

    const result = await executeHostCommand(sshpassCmd);
    if (!result.stdout.includes('OK')) {
        throw new Error(`Key install on target failed: ${result.stdout}\n${result.stderr}`);
    }

    // 3. Verify key auth + sudo work for subsequent steps
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
        throw new Error(`Key auth + sudo verification on target failed: ${verify.stdout} / ${verify.stderr}`);
    }

    return { privateKeyPath, publicKey, migrationUser, runId };
}

/**
 * Remove our pubkey from the target migration user's authorized_keys, plus
 * the local private key file on the source host. Best-effort: errors are
 * logged but not rethrown — cleanup must never mask the migration's actual
 * success/failure.
 *
 * The migration user account on the target is intentionally NOT removed —
 * the target's user disables it from their UI (a single button-press there
 * also surfaces the lifecycle so they're aware).
 */
export async function cleanupMigrationKey(
    keypair: MigrationKeyPair,
    req: MigrationRequest
): Promise<void> {
    const cleanupScript = `
set +e
PUB_KEY="$1"
if [ -f "$HOME/.ssh/authorized_keys" ]; then
    grep -vF "$PUB_KEY" "$HOME/.ssh/authorized_keys" > "$HOME/.ssh/authorized_keys.tmp" 2>/dev/null || true
    mv "$HOME/.ssh/authorized_keys.tmp" "$HOME/.ssh/authorized_keys" 2>/dev/null || true
fi
echo DONE
`.trim();

    try {
        const scriptEncoded = Buffer.from(cleanupScript, 'utf8').toString('base64');
        const sshCmd = [
            'ssh',
            '-i', shq(keypair.privateKeyPath),
            '-o', 'StrictHostKeyChecking=accept-new',
            '-o', 'BatchMode=yes',
            '-o', 'ConnectTimeout=10',
            `${keypair.migrationUser}@${req.host}`,
            shq(`echo ${scriptEncoded} | base64 -d | bash -s -- ${shq(keypair.publicKey)}`),
        ].join(' ');
        await executeHostCommand(sshCmd);
    } catch (err) {
        console.error('[Migration] target authorized_keys cleanup failed (non-fatal):', err);
    }

    try {
        await executeHostCommand(`rm -f ${shq(keypair.privateKeyPath)} ${shq(keypair.privateKeyPath + '.pub')}`);
    } catch (err) {
        console.error('[Migration] local key cleanup failed (non-fatal):', err);
    }
}
