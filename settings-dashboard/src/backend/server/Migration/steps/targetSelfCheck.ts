import { execOnTarget, MigrationKeyPair, shq } from '../MigrationSSH';

const SELF_CHECK_SCRIPT = '/DATA/AppData/casaos/apps/yundera/scripts/self-check.sh';
const LOG_FILE = '/DATA/AppData/casaos/apps/yundera/log/yundera.log';

/**
 * After the offline diff rsync, trigger the target's self-check by SSHing
 * into the target and running self-check.sh there. The script exits non-zero
 * if any ensure-*.sh failed; we surface that as a thrown error so the
 * migration orchestrator triggers rollback.
 *
 * The self-check is the migration's finish line:
 *   - ensure-public-ip.sh re-detects target IP and overwrites the copied value
 *   - ensure-yundera-user-data.sh fetches user data via copied USER_JWT
 *     (this doubles as our acceptance test — if the JWT didn't transfer
 *     correctly, this script fails and the whole migration reports failure)
 *   - ensure-auth-secrets.sh preserves Authelia/OIDC material (idempotent, skips when files exist)
 *   - ensure-user-compose-pulled.sh / ensure-user-compose-stack-up.sh bring apps up
 *
 * The self-check script is bundled inside the rsynced /DATA tree, so a
 * bare-Ubuntu target inherits it from the source's data and runs it from
 * there.
 */
export async function triggerTargetSelfCheck(
    keypair: MigrationKeyPair,
    target: string
): Promise<void> {
    try {
        await execOnTarget(keypair, target, `bash ${shq(SELF_CHECK_SCRIPT)}`, {
            sudo: true,
            timeout: 15 * 60 * 1000,
        });
    } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        let logTail = '';
        try {
            const tail = await execOnTarget(keypair, target, `tail -n 200 ${shq(LOG_FILE)}`, { sudo: true });
            logTail = tail.stdout || '';
        } catch {
            // best-effort
        }
        throw new Error(
            `Target self-check failed: ${errorMsg}` +
            (logTail ? `\n--- Log tail (target) ---\n${logTail}` : '')
        );
    }
}
