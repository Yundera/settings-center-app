import { basename, dirname } from 'path';
import { executeHostCommand } from '@/backend/cmd/HostExecutor';
import { MigrationRequest, PreflightResult } from '../MigrationTypes';
import { shq, sshpassToTarget, waitForTargetSSH } from '../MigrationSSH';
import { assertRootfulDocker } from '../MigrationVolumes';

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

// Keep at least this much free on the target AFTER the transfer. A flat floor
// (not a ×margin) on purpose: a proportional buffer would block large but
// otherwise-fitting "loaded" PCS, and 20 GB is enough headroom to operate in
// every case.
const HEADROOM_BYTES = 20 * 1024 * 1024 * 1024;

export async function runPreflight(req: MigrationRequest): Promise<PreflightResult> {
    const checks: PreflightResult['checks'] = [];
    let sourceSizeBytes: number | undefined;
    let targetFreeBytes: number | undefined;

    // 0. Source health gate — block if the source's OWN last self-check ended
    //    "with failures". This is the same authoritative self-check that runs
    //    on the TARGET at cutover (targetSelfCheck), shifted left onto the
    //    source so a degraded PCS is rejected BEFORE the data push and the
    //    source-container stop — instead of failing late, after the expensive
    //    transfer, having faithfully copied broken state (e.g. a blanked
    //    USER_JWT) onto the target.
    //
    //    Deliberately READ-ONLY: it tails the persisted self-check log rather
    //    than triggering a fresh run. Running self-check here would be unsafe —
    //    its tail does `docker compose up -d` on the yundera system stack,
    //    which would recreate the `admin` container driving THIS migration and
    //    rotate USER_JWT (the very reasons stopSource excludes that stack and
    //    disables the nightly cron). So we accept a possibly-stale verdict (up
    //    to the nightly cadence) as the trade-off. Reading self-check's own
    //    aggregate verdict also means this gate auto-tracks any env/process
    //    checks self-check gains later — there is no parallel precondition list
    //    to drift out of sync here.
    //
    //    Only an explicit "with failures" blocks. A missing/indeterminate log
    //    (rotation, truncation, fresh boot) passes — we don't add a new way to
    //    block migrations on a signal we can't read.
    try {
        const probe = `
LOG="/DATA/AppData/casaos/apps/yundera/log/yundera.log"
if ! sudo -n test -f "$LOG" 2>/dev/null; then
  echo "STATUS=UNKNOWN"; echo "reason=no self-check log at $LOG"; exit 0
fi
TAIL="$(sudo -n tail -n 4000 "$LOG" 2>/dev/null)"
if [ -z "$TAIL" ]; then
  echo "STATUS=UNKNOWN"; echo "reason=self-check log empty or unreadable"; exit 0
fi
COMP="$(printf '%s\\n' "$TAIL" | grep -nE 'Self-check completed (successfully|with failures)' | tail -n1)"
if [ -z "$COMP" ]; then
  echo "STATUS=UNKNOWN"; echo "reason=no self-check completion line in last 4000 log lines"; exit 0
fi
COMP_IDX="\${COMP%%:*}"
COMP_LINE="\${COMP#*:}"
if printf '%s' "$COMP_LINE" | grep -q 'completed successfully'; then
  echo "STATUS=OK"; printf '%s\\n' "$COMP_LINE"; exit 0
fi
START_IDX="$(printf '%s\\n' "$TAIL" | sed -n "1,\${COMP_IDX}p" | grep -nE 'Self-check starting' | tail -n1 | cut -d: -f1)"
[ -z "$START_IDX" ] && START_IDX=1
echo "STATUS=FAILED"; printf '%s\\n' "$COMP_LINE"
printf '%s\\n' "$TAIL" | sed -n "\${START_IDX},\${COMP_IDX}p" | grep -E ': failed \\(exit code' | tail -n 20 || true
`;
        const out = await executeHostCommand(probe);
        const lines = out.stdout.split('\n');
        const status = (lines.find(l => l.startsWith('STATUS=')) ?? 'STATUS=UNKNOWN')
            .slice('STATUS='.length).trim();
        const reason = (lines.find(l => l.startsWith('reason=')) ?? '')
            .slice('reason='.length).trim();
        const body = lines
            .filter(l => l.trim() && !l.startsWith('STATUS=') && !l.startsWith('reason='))
            .map(l => l.trim());

        if (status === 'FAILED') {
            const verdict = body[0] ?? 'self-check completed with failures';
            const failedScripts = body.slice(1);
            checks.push({
                name: 'source_self_check',
                ok: false,
                message:
                    `Source's last self-check ended WITH FAILURES — fix the source before migrating ` +
                    `(migration would otherwise copy the broken state to the target). ${verdict}` +
                    (failedScripts.length ? `\nFailing scripts:\n${failedScripts.join('\n')}` : ''),
            });
            return { ok: false, checks };
        }

        if (status === 'OK') {
            checks.push({
                name: 'source_self_check',
                ok: true,
                message: `Source's last self-check passed — ${body[0] ?? 'completed successfully'}`,
            });
        } else {
            // UNKNOWN — indeterminate signal, non-blocking (see note above).
            checks.push({
                name: 'source_self_check',
                ok: true,
                message: `Source self-check status indeterminate, proceeding${reason ? ` (${reason})` : ''}`,
            });
        }
    } catch (err) {
        // Reading the source log failed (unexpected — we run inside the source's
        // own admin container). Non-blocking, consistent with the "only explicit
        // failures block" rule; a genuinely broken source surfaces in later steps.
        checks.push({
            name: 'source_self_check',
            ok: true,
            message: `Could not read source self-check log, proceeding: ${errMsg(err)}`,
        });
    }

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

    // Source Docker mode — named volumes are copied by a host-path rsync,
    // which only reproduces ownership correctly on rootful Docker with the
    // default data-root and no userns-remap. Fail loud if that ever drifts.
    try {
        await assertRootfulDocker();
        checks.push({
            name: 'docker_mode',
            ok: true,
            message: 'Source Docker is rootful with the default data-root',
        });
    } catch (err) {
        checks.push({ name: 'docker_mode', ok: false, message: errMsg(err) });
        return { ok: false, checks };
    }

    // Locally-built images — the target pulls images from a registry, so an
    // app with a `build:` directive has nothing to pull. Reject it here with
    // a clear message. (Other unpullable images surface later in docker_pull.)
    try {
        const findOut = await executeHostCommand(
            `find /DATA/AppData/casaos/apps -mindepth 2 -maxdepth 2 -type f ` +
            `\\( -name docker-compose.yml -o -name docker-compose.yaml -o -name compose.yml \\) 2>/dev/null`
        );
        const composeFiles = findOut.stdout.split('\n')
            .map(l => l.trim())
            .filter(Boolean)
            .filter(f => basename(dirname(f)) !== 'yundera');
        const buildApps: string[] = [];
        for (const f of composeFiles) {
            try {
                const cfg = await executeHostCommand(`sudo -n docker compose -f ${shq(f)} config 2>/dev/null`);
                // `docker compose config` emits normalized YAML; a service that
                // builds locally has a `build:` key indented under it.
                if (/^\s+build:/m.test(cfg.stdout)) buildApps.push(basename(dirname(f)));
            } catch {
                // A compose file that won't even `config` is a separate
                // problem; docker_pull / self-check will surface it. Don't
                // block the build-image check on it.
            }
        }
        if (buildApps.length > 0) {
            checks.push({
                name: 'build_images',
                ok: false,
                message: `App(s) build their image locally and cannot be migrated: ` +
                    `${buildApps.join(', ')}. Migration requires registry-pullable images.`,
            });
            return { ok: false, checks };
        }
        checks.push({ name: 'build_images', ok: true, message: 'All user apps use registry images' });
    } catch (err) {
        checks.push({ name: 'build_images', ok: false, message: `build-image scan failed: ${errMsg(err)}` });
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

    // 4. Source data size — read the USED bytes of the filesystem backing
    // /DATA straight from `df`. `df <path>` resolves to whatever filesystem
    // holds /DATA (the dedicated LVM volume on Proxmox, the root fs on
    // commodity VPS), so it's an O(1) metadata read in every layout — no tree
    // walk, and it can't time out the way `du -sb /DATA` does. A real `du`
    // lstat()s every inode, which on a PCS with millions of small files
    // (Nextcloud, media) blows past the host-command budget — the "Command
    // timed out after 600000ms" that aborts migrations in preflight.
    //
    // The figure is a deliberately conservative over-estimate: it also counts
    // /var/lib/docker (docker images, overlay layers AND the named volumes we
    // migrate; on commodity VPS the OS too). We do NOT add named-volume size
    // separately — df already includes it. The docker image/overlay weight is
    // subtracted back out in step 5 only if the raw figure doesn't fit.
    try {
        const out = await executeHostCommand(`df -B1 --output=used /DATA | tail -n1`);
        sourceSizeBytes = parseInt(out.stdout.trim(), 10);
        if (!Number.isFinite(sourceSizeBytes) || sourceSizeBytes <= 0) {
            throw new Error(`could not measure /DATA size from df: ${out.stdout.slice(0, 200)}`);
        }
        checks.push({
            name: 'source_data_size',
            ok: true,
            message: `Source data (fs backing /DATA): ${formatBytes(sourceSizeBytes)}`,
        });
    } catch (err) {
        checks.push({ name: 'source_data_size', ok: false, message: `/DATA size check on source failed: ${errMsg(err)}` });
        return { ok: false, checks };
    }

    // 5. Target free space — go/no-go ladder:
    //   (a) raw df estimate + 20 GB headroom fits                 -> GO
    //   (b) else subtract the docker images/overlay/build-cache that the
    //       target re-pulls (never rsynced) and re-test with the headroom -> GO
    //   (c) else block with the exact shortfall.
    // No `du` anywhere: a measurement that can't complete must never be what
    // blocks a migration. The check is advisory by design — the source is
    // untouched until cutover and any real out-of-space failure during rsync
    // auto-rolls-back (see Migration.ts), so we only aim to avoid wasting the
    // rsync hours, not to guarantee space.
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

        // (a) Raw estimate.
        if (targetFreeBytes >= sourceSizeBytes! + HEADROOM_BYTES) {
            checks.push({
                name: 'target_free_space',
                ok: true,
                message: `Target free: ${formatBytes(targetFreeBytes)} ` +
                    `(need ${formatBytes(sourceSizeBytes!)} + ${formatBytes(HEADROOM_BYTES)} headroom)`,
            });
        } else {
            // (b) Refine: drop the docker images/overlay/build-cache the target
            // re-pulls rather than receives over rsync. Cheap daemon metadata
            // (`docker system df`), no tree walk. Named volumes ARE migrated, so
            // they stay counted.
            const nonMigrated = await sourceDockerNonMigratedBytes();
            const refined = Math.max(0, sourceSizeBytes! - nonMigrated);
            const required = refined + HEADROOM_BYTES;
            const ok = targetFreeBytes >= required;
            checks.push({
                name: 'target_free_space',
                ok,
                message: ok
                    ? `Target free: ${formatBytes(targetFreeBytes)} ` +
                      `(refined need ${formatBytes(refined)} + ${formatBytes(HEADROOM_BYTES)} headroom; ` +
                      `excluded ${formatBytes(nonMigrated)} docker images/overlay)`
                    : `Target has ${formatBytes(targetFreeBytes)} free, need ${formatBytes(required)} ` +
                      `(data ${formatBytes(refined)} after excluding ${formatBytes(nonMigrated)} docker images/overlay ` +
                      `+ ${formatBytes(HEADROOM_BYTES)} headroom) — short by ${formatBytes(required - targetFreeBytes)}`,
            });
            // (c) Still short -> block with the shortfall above.
            if (!ok) return { ok: false, checks, sourceSizeBytes, targetFreeBytes };
        }
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

/**
 * On-disk bytes that the `df` source estimate counts but that rsync does NOT
 * transfer: docker images, container writable/overlay layers, and build cache.
 * The target re-pulls images during the docker_pull step, so these never go
 * over the wire. Named (local) volumes are deliberately excluded here — they
 * ARE migrated and must stay in the size estimate.
 *
 * Reads `docker system df` — daemon metadata, fast, no tree walk. Best-effort:
 * any parse miss contributes 0, which under-subtracts and so keeps the estimate
 * conservative (we never claim more space is free than really is). Requires
 * rootful docker, already asserted by the docker_mode check above.
 */
async function sourceDockerNonMigratedBytes(): Promise<number> {
    const out = await executeHostCommand(
        `sudo -n docker system df --format '{{.Type}}|{{.Size}}' 2>/dev/null || true`
    );
    let bytes = 0;
    for (const line of out.stdout.split('\n')) {
        const [type, size] = line.split('|');
        if (!type || !size) continue;
        const t = type.trim().toLowerCase();
        // "Local Volumes" intentionally omitted — those are migrated.
        if (t === 'images' || t === 'containers' || t === 'build cache') {
            bytes += parseHumanSize(size);
        }
    }
    return bytes;
}

/**
 * Parse a `docker system df` size string (e.g. "1.234GB", "120MB", "0B") into
 * bytes. Docker formats with base-1000 SI units, so we decode the same way;
 * an unrecognized string yields 0 (the conservative direction — see caller).
 */
function parseHumanSize(s: string): number {
    const m = s.trim().match(/^([\d.]+)\s*([kKmMgGtTpP]?)i?B$/);
    if (!m) return 0;
    const val = parseFloat(m[1]);
    if (!Number.isFinite(val)) return 0;
    const mult: Record<string, number> = { '': 1, k: 1e3, m: 1e6, g: 1e9, t: 1e12, p: 1e15 };
    return val * (mult[m[2].toLowerCase()] ?? 1);
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
