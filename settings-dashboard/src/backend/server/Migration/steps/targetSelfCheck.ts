import { runSelfCheck } from '../../SelfCheck/SelfCheck';

/**
 * After the offline diff rsync, trigger the target's self-check.
 *
 * The self-check is the migration's finish line:
 *   - ensure-public-ip.sh re-detects target IP and overwrites the copied value
 *   - ensure-yundera-user-data.sh fetches user data via copied USER_JWT
 *     (this doubles as our acceptance test — if the JWT didn't transfer
 *     correctly, this script fails and the whole migration reports failure)
 *   - ensure-auth-secrets.sh preserves Authelia/OIDC material (idempotent, skips when files exist)
 *   - ensure-user-compose-pulled.sh / ensure-user-compose-stack-up.sh bring apps up
 */
export async function triggerTargetSelfCheck(): Promise<void> {
    await runSelfCheck();

    // If the self-check reported any per-script failure, that's a migration
    // failure — callers treat this function throwing as a signal to roll back.
    // runSelfCheck itself only throws on infrastructure errors (SSH to host
    // down, scripts config missing). A partial/failed overall status is
    // reported in its own context but not rethrown. Read the status and
    // surface any failure as a thrown error so the migration orchestrator
    // triggers rollback.
    const { getSelfCheckStatus } = await import('../../SelfCheck/SelfCheck');
    const status = await getSelfCheckStatus();
    if (status.overallStatus !== 'success') {
        const failedScripts = Object.entries(status.scripts)
            .filter(([, r]) => !r.success)
            .map(([name, r]) => `${name}: ${r.message}`);
        throw new Error(
            `Target self-check ${status.overallStatus}. Failed scripts:\n${failedScripts.join('\n') || '(none reported)'}`
        );
    }
}
