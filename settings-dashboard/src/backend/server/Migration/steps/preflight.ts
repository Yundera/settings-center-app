import { executeHostCommand } from '@/backend/cmd/HostExecutor';
import { MigrationRequest, PreflightResult } from '../MigrationTypes';
import { shq, sshpassToTarget, waitForTargetSSH } from '../MigrationSSH';

/**
 * Preflight runs from the SOURCE host and verifies the TARGET is reachable
 * and ready. The migration account on the target was created by the target's
 * user via its own admin UI; we use its password here exactly once to install
 * an SSH key on the target. After this step everything else uses key auth.
 *
 *   - SSH reachability + sudo on target
 *   - source /DATA size vs target free space
 *   - target /DATA/AppData is blank (or absent for bare-Ubuntu targets)
 *   - clock skew sanity
 *
 * sshpass is a standard Ubuntu package but not always installed on the source
 * host. We install it on-demand as the very first check.
 */

const SAFETY_MARGIN = 1.1; // require 10% more target free space than source size

export async function runPreflight(req: MigrationRequest): Promise<PreflightResult> {
    const checks: PreflightResult['checks'] = [];
    let sourceSizeBytes: number | undefined;
    let targetFreeBytes: number | undefined;

    // 1. Ensure sshpass + rsync on the source host (we initiate from here)
    try {
        await executeHostCommand(`DEBIAN_FRONTEND=noninteractive apt-get install -y sshpass rsync >/dev/null 2>&1 || sudo -n DEBIAN_FRONTEND=noninteractive apt-get install -y sshpass rsync >/dev/null 2>&1`);
        checks.push({ name: 'source_tooling', ok: true, message: 'sshpass and rsync available on source host' });
    } catch (err) {
        checks.push({
            name: 'source_tooling',
            ok: false,
            message: `Cannot install sshpass/rsync on source host: ${errMsg(err)}`,
        });
        return { ok: false, checks };
    }

    // 1b. Wipe any stale host key for the target IP from the source's
    //     known_hosts. Migration targets come from a recycled IP pool — the
    //     same IP can return with a fresh host key on a later attempt, and
    //     ssh's `accept-new` policy (used by every step below: preflight,
    //     pushKey, rsync) will hard-fail with "REMOTE HOST IDENTIFICATION
    //     HAS CHANGED" rather than re-trust. We're authenticating with
    //     a one-time password the orchestrator just minted for this exact
    //     target, so the prior key is meaningless here. Idempotent: ssh-keygen
    //     -R succeeds even if the host has no entry.
    try {
        await executeHostCommand(`ssh-keygen -R ${shq(req.host)} >/dev/null 2>&1; sudo -n ssh-keygen -R ${shq(req.host)} >/dev/null 2>&1; true`);
    } catch {
        // Best-effort — if it errors we'll catch the consequence at the next SSH step.
    }

    // 2. SSH reachability to target with provided password. waitForTargetSSH
    //    polls for several minutes, so a freshly-provisioned target that is
    //    still mid-reboot is waited out rather than hard-failing preflight.
    try {
        await waitForTargetSSH(req);
        checks.push({ name: 'target_ssh', ok: true, message: `SSH to ${req.user}@${req.host} succeeded` });
    } catch (err) {
        checks.push({ name: 'target_ssh', ok: false, message: `SSH to target failed: ${errMsg(err)}` });
        return { ok: false, checks };
    }

    // 3. Passwordless sudo on target — the migration account is set up with
    //    NOPASSWD when enabled via the target's UI.
    try {
        const out = await sshpassToTarget(req, `sudo -n whoami`);
        if (!out.stdout.trim().includes('root')) {
            throw new Error(`sudo -n returned ${out.stdout.trim() || '<empty>'} (expected 'root')`);
        }
        checks.push({ name: 'target_sudo', ok: true, message: `${req.user} has passwordless sudo on target` });
    } catch (err) {
        checks.push({ name: 'target_sudo', ok: false, message: `sudo check on target failed: ${errMsg(err)}` });
        return { ok: false, checks };
    }

    // 4. Source /DATA size (local du)
    try {
        const out = await executeHostCommand(`sudo -n du -sb /DATA 2>/dev/null | awk '{print $1}'`);
        sourceSizeBytes = parseInt(out.stdout.trim(), 10);
        if (!Number.isFinite(sourceSizeBytes) || sourceSizeBytes <= 0) {
            throw new Error(`could not parse du output: ${out.stdout.slice(0, 200)}`);
        }
        checks.push({
            name: 'source_data_size',
            ok: true,
            message: `Source /DATA: ${formatBytes(sourceSizeBytes)}`,
        });
    } catch (err) {
        checks.push({ name: 'source_data_size', ok: false, message: `du /DATA on source failed: ${errMsg(err)}` });
        return { ok: false, checks };
    }

    // 5. Target free space on /DATA (or its parent if /DATA doesn't exist yet)
    try {
        // Fall back to / if /DATA doesn't exist on target yet (bare Ubuntu case).
        // No `$variables` here on purpose: HostExecutor.executeHostCommand
        // wraps the whole command in outer double-quotes and only escapes `"`
        // — `$NAME` gets expanded by the *host's* shell before it ever reaches
        // the target, which silently turns "$P" into "" and breaks df.
        // Earlier piped form `df /DATA … | tail -n1 || df / …` also fails
        // because tail exits 0 on empty input, so the || never fires.
        const out = await sshpassToTarget(
            req,
            `if [ -d /DATA ]; then df --output=avail -B1 /DATA | tail -n1; else df --output=avail -B1 / | tail -n1; fi`
        );
        targetFreeBytes = parseInt(out.stdout.trim(), 10);
        if (!Number.isFinite(targetFreeBytes) || targetFreeBytes <= 0) {
            throw new Error(`could not parse df output: ${out.stdout.slice(0, 200)}`);
        }
        const required = Math.ceil(sourceSizeBytes! * SAFETY_MARGIN);
        const ok = targetFreeBytes >= required;
        checks.push({
            name: 'target_free_space',
            ok,
            message: ok
                ? `Target free: ${formatBytes(targetFreeBytes)} (required ~${formatBytes(required)})`
                : `Target has ${formatBytes(targetFreeBytes)} free, need ~${formatBytes(required)} (source × ${SAFETY_MARGIN})`,
        });
        if (!ok) return { ok: false, checks, sourceSizeBytes, targetFreeBytes };
    } catch (err) {
        checks.push({ name: 'target_free_space', ok: false, message: `df /DATA on target failed: ${errMsg(err)}` });
        return { ok: false, checks };
    }

    // 6. Target blank: /DATA/AppData must be absent or contain only the
    //    bootstrap dirs (casaos / yundera). A target that's already running
    //    user apps would have those overwritten — refuse.
    try {
        const out = await sshpassToTarget(
            req,
            `if [ ! -d /DATA/AppData ]; then echo MISSING; else ls /DATA/AppData 2>/dev/null | grep -vE '^(casaos|yundera)$' | wc -l; fi`
        );
        const trimmed = out.stdout.trim();
        if (trimmed === 'MISSING') {
            checks.push({ name: 'target_blank', ok: true, message: '/DATA/AppData absent on target — will be created' });
        } else {
            const extraCount = parseInt(trimmed, 10) || 0;
            if (extraCount > 0) {
                const list = await sshpassToTarget(
                    req,
                    `ls /DATA/AppData 2>/dev/null | grep -vE '^(casaos|yundera)$' | head -20`
                );
                checks.push({
                    name: 'target_blank',
                    ok: false,
                    message: `Target /DATA/AppData already contains user apps (${extraCount} entries); migration requires a fresh PCS. Sample: ${list.stdout.split('\n').filter(Boolean).join(', ')}`,
                });
                return { ok: false, checks, sourceSizeBytes, targetFreeBytes };
            }
            checks.push({ name: 'target_blank', ok: true, message: 'Target /DATA/AppData has no user apps' });
        }
    } catch (err) {
        checks.push({ name: 'target_blank', ok: false, message: `Target blank check failed: ${errMsg(err)}` });
        return { ok: false, checks };
    }

    // 7. Clock skew sanity (warn if > 60s)
    try {
        const [sourceOut, targetOut] = await Promise.all([
            executeHostCommand(`date +%s`),
            sshpassToTarget(req, `date +%s`),
        ]);
        const s = parseInt(sourceOut.stdout.trim(), 10);
        const t = parseInt(targetOut.stdout.trim(), 10);
        const skew = Math.abs(t - s);
        const ok = skew < 60;
        checks.push({
            name: 'clock_skew',
            ok,
            message: ok ? `Clock skew ${skew}s` : `Clock skew ${skew}s exceeds 60s — rsync mtimes may be unreliable`,
        });
        if (!ok) return { ok: false, checks, sourceSizeBytes, targetFreeBytes };
    } catch (err) {
        checks.push({ name: 'clock_skew', ok: false, message: `Clock skew check failed: ${errMsg(err)}` });
        return { ok: false, checks };
    }

    return { ok: true, checks, sourceSizeBytes, targetFreeBytes };
}

function errMsg(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

function formatBytes(n: number): string {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    let v = n;
    while (v >= 1024 && i < units.length - 1) {
        v /= 1024;
        i++;
    }
    return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}
