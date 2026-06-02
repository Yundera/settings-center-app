import { executeHostCommand } from "@/backend/cmd/HostExecutor";
import packageJson from "../../../../package.json";

const LOG_FILE = "/DATA/AppData/casaos/apps/yundera/log/yundera.log";

// Tail enough lines to almost certainly contain the most recent self-check
// summary line even when there are several runs and verbose script output
// between them. Reading 2000 lines via SSH is still cheap.
const LOG_TAIL_LINES = 2000;

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

export type SelfCheckStatus = {
    ok: boolean | null;          // null = no completion line found yet
    lastRunAt: string | null;    // ISO 8601, or null if unknown
    // Per-script tally for the most recent run, derived from the
    // `<script> : success/failed` lines execute_script_with_logging emits
    // between `Self-check starting` and the completion line. Both null when
    // the run window can't be reconstructed from the log tail (e.g. truncated
    // tail, or no run observed yet).
    passed: number | null;       // ensure-scripts that exited 0
    total: number | null;        // ensure-scripts attempted
};

export type HealthSnapshot = {
    version: string;
    selfCheck: SelfCheckStatus;
    lastRefreshedAt: string | null; // ISO 8601 of last successful refresh
};

const VERSION: string = (packageJson as { version?: string }).version ?? "unknown";

let snapshot: HealthSnapshot = {
    version: VERSION,
    selfCheck: { ok: null, lastRunAt: null, passed: null, total: null },
    lastRefreshedAt: null,
};

let refreshTimer: NodeJS.Timeout | null = null;

/**
 * Public read of the cached snapshot. Pure RAM lookup — safe to expose on a
 * public endpoint.
 */
export function getHealthSnapshot(): HealthSnapshot {
    return snapshot;
}

// Per-ensure-script result lines emitted by execute_script_with_logging
// (library/log.sh) — one per script, anchored on the [SUCCESS]/[ERROR] level
// tag so a child script that happens to echo "success" in its own OUTPUT
// lines can't be miscounted:
//   [ts] [SUCCESS] === [datetime] ensure-foo.sh : success (2s) ===
//   [ts] [ERROR]   === [datetime] ensure-bar.sh : failed (exit code: 1, 3s) ===
const SCRIPT_OK_RE = /^\[[^\]]+\]\s+\[SUCCESS\]\s+===.*:\s+success\s+\(/;
const SCRIPT_FAIL_RE = /^\[[^\]]+\]\s+\[ERROR\]\s+===.*:\s+failed\s+\(exit code:/;
const SELF_CHECK_START_RE = /Self-check starting/;

/**
 * Count the per-script pass/fail tally for the run that ends at
 * `completionIdx`. The run window is bounded below by the most recent
 * `Self-check starting` line before the completion line; if that boundary
 * isn't in the tail (truncated window) we can't trust the count and return
 * nulls. `total === 0` (no script lines found) is likewise treated as
 * unknown rather than a misleading 0/0.
 */
function countRunTally(
    lines: string[],
    completionIdx: number
): { passed: number | null; total: number | null } {
    let startIdx = -1;
    for (let i = completionIdx - 1; i >= 0; i--) {
        if (SELF_CHECK_START_RE.test(lines[i])) {
            startIdx = i;
            break;
        }
    }
    if (startIdx < 0) return { passed: null, total: null };

    let passed = 0;
    let failed = 0;
    for (let i = startIdx + 1; i < completionIdx; i++) {
        if (SCRIPT_OK_RE.test(lines[i])) passed++;
        else if (SCRIPT_FAIL_RE.test(lines[i])) failed++;
    }
    const total = passed + failed;
    if (total === 0) return { passed: null, total: null };
    return { passed, total };
}

/**
 * Parse a log tail and find the most recent self-check completion line.
 * Self-check.sh emits exactly one of these lines per run:
 *   [YYYY-MM-DD HH:MM:SS] [LEVEL] === Self-check completed successfully ===
 *   [YYYY-MM-DD HH:MM:SS] [LEVEL] === Self-check completed with failures ===
 * The per-script tally (passed/total) is reconstructed from the result lines
 * inside that run's window — see countRunTally.
 */
function parseSelfCheckStatus(logTail: string): SelfCheckStatus {
    const lines = logTail.split("\n");
    // Walk from the end so we find the most recent completion line first.
    for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i];
        const match = line.match(
            /^\[(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})\]\s+\[[A-Z]+\]\s+.*Self-check completed (successfully|with failures)/
        );
        if (match) {
            const [, date, time, outcome] = match;
            const { passed, total } = countRunTally(lines, i);
            // The host writes timestamps in local time (no zone in the log).
            // We can only return what we have — emit the bare local timestamp
            // so callers don't get a falsely-precise UTC value.
            return {
                ok: outcome === "successfully",
                lastRunAt: `${date}T${time}`,
                passed,
                total,
            };
        }
    }
    return { ok: null, lastRunAt: null, passed: null, total: null };
}

/**
 * Refresh the cached snapshot by reading the host log over SSH.
 * Failures are swallowed — we keep the previous snapshot rather than
 * blanking it on a transient SSH hiccup.
 */
export async function refreshHealthSnapshot(): Promise<void> {
    try {
        const result = await executeHostCommand(
            `tail -n ${LOG_TAIL_LINES} ${LOG_FILE}`
        );
        const selfCheck = parseSelfCheckStatus(result.stdout || "");
        snapshot = {
            version: VERSION,
            selfCheck,
            lastRefreshedAt: new Date().toISOString(),
        };
    } catch (error) {
        console.warn(
            "Health: failed to refresh self-check status from host log:",
            error instanceof Error ? error.message : String(error)
        );
    }
}

/**
 * Kick off the first refresh and arm the periodic timer. Idempotent.
 */
export function startHealthRefresh(): void {
    if (refreshTimer) {
        return;
    }
    void refreshHealthSnapshot();
    refreshTimer = setInterval(() => {
        void refreshHealthSnapshot();
    }, REFRESH_INTERVAL_MS);
    // Don't keep the event loop alive just for this timer.
    refreshTimer.unref?.();
}
