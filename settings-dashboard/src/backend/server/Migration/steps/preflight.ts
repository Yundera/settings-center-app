import { executeHostCommand } from '@/backend/cmd/HostExecutor';
import { MigrationRequest, PreflightResult } from '../MigrationTypes';
import { shq } from '../MigrationSSH';

/**
 * Preflight runs BEFORE we push a key. It uses the operator's password
 * (one-shot, via sshpass on the target host) to verify:
 *   - SSH reachability to source with provided creds
 *   - sudo on source
 *   - /DATA size on source vs free space on target
 *   - clock skew sanity
 *
 * sshpass is a standard Ubuntu package but not always installed. We
 * install it on-demand on the target host as the very first check.
 */

const SAFETY_MARGIN = 1.1; // require 10% more target free space than source size

export async function runPreflight(req: MigrationRequest): Promise<PreflightResult> {
    const checks: PreflightResult['checks'] = [];
    let sourceSizeBytes: number | undefined;
    let targetFreeBytes: number | undefined;

    // 1. Ensure sshpass + rsync on target host (both required for later steps)
    try {
        await executeHostCommand(`DEBIAN_FRONTEND=noninteractive apt-get install -y sshpass rsync >/dev/null 2>&1 || sudo -n DEBIAN_FRONTEND=noninteractive apt-get install -y sshpass rsync >/dev/null 2>&1`);
        checks.push({ name: 'target_tooling', ok: true, message: 'sshpass and rsync available on target host' });
    } catch (err) {
        checks.push({
            name: 'target_tooling',
            ok: false,
            message: `Cannot install sshpass/rsync on target host: ${errMsg(err)}`,
        });
        return { ok: false, checks };
    }

    // 2. SSH reachability to source with provided password
    try {
        const out = await sshpassOnHost(req, 'echo OK');
        if (!out.stdout.includes('OK')) {
            throw new Error(`Unexpected response: ${out.stdout.slice(0, 200)}`);
        }
        checks.push({ name: 'source_ssh', ok: true, message: `SSH to ${req.user}@${req.host} succeeded` });
    } catch (err) {
        checks.push({ name: 'source_ssh', ok: false, message: `SSH to source failed: ${errMsg(err)}` });
        return { ok: false, checks };
    }

    // 3. Sudo on source — we need it to create a migration user, read /DATA as root, and stop containers
    try {
        await sshpassOnHost(req, `echo ${shq(req.password)} | sudo -S -p '' -v`);
        checks.push({ name: 'source_sudo', ok: true, message: `User ${req.user} has sudo` });
    } catch (err) {
        checks.push({ name: 'source_sudo', ok: false, message: `sudo check on source failed: ${errMsg(err)}` });
        return { ok: false, checks };
    }

    // 4. Source /DATA size
    try {
        const out = await sshpassOnHost(req, `echo ${shq(req.password)} | sudo -S -p '' du -sb /DATA 2>/dev/null | awk '{print $1}'`);
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

    // 5. Target free space on /DATA
    try {
        const out = await executeHostCommand(`df --output=avail -B1 /DATA | tail -n1`);
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

    // 6. Fresh-target invariant: /DATA/AppData must have at most casaos + yundera system dirs
    try {
        const out = await executeHostCommand(`ls /DATA/AppData 2>/dev/null | grep -vE '^(casaos|yundera)$' | wc -l`);
        const extraCount = parseInt(out.stdout.trim(), 10) || 0;
        if (extraCount > 0) {
            const list = await executeHostCommand(`ls /DATA/AppData 2>/dev/null | grep -vE '^(casaos|yundera)$' | head -20`);
            checks.push({
                name: 'target_blank',
                ok: false,
                message: `Target /DATA/AppData already contains user apps (${extraCount} entries); migration requires a fresh PCS. Sample: ${list.stdout.split('\n').filter(Boolean).join(', ')}`,
            });
            return { ok: false, checks, sourceSizeBytes, targetFreeBytes };
        }
        checks.push({ name: 'target_blank', ok: true, message: 'Target /DATA/AppData has no user apps' });
    } catch (err) {
        checks.push({ name: 'target_blank', ok: false, message: `Target blank check failed: ${errMsg(err)}` });
        return { ok: false, checks };
    }

    // 7. Clock skew sanity (warn if > 60s)
    try {
        const [targetOut, sourceOut] = await Promise.all([
            executeHostCommand(`date +%s`),
            sshpassOnHost(req, `date +%s`),
        ]);
        const t = parseInt(targetOut.stdout.trim(), 10);
        const s = parseInt(sourceOut.stdout.trim(), 10);
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

/**
 * Run a command on the source PCS from the target host using sshpass.
 * Used only during preflight and the initial key-push step — everything
 * after that uses key auth.
 */
async function sshpassOnHost(
    req: MigrationRequest,
    remoteCmd: string
): Promise<{ stdout: string; stderr: string }> {
    // Pass password through env var SSHPASS — never on the command line where
    // it would land in /proc/*/cmdline and host-side shell history.
    const cmd = [
        `SSHPASS=${shq(req.password)}`,
        'sshpass',
        '-e',
        'ssh',
        '-o', 'StrictHostKeyChecking=accept-new',
        '-o', 'ConnectTimeout=10',
        '-o', 'PreferredAuthentications=password',
        '-o', 'PubkeyAuthentication=no',
        `${req.user}@${req.host}`,
        shq(remoteCmd),
    ].join(' ');
    return executeHostCommand(cmd);
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
