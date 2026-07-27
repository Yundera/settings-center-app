import { executeHostCommand } from "@/backend/cmd/HostExecutor";
import { latestCompletedSelfCheckRun } from "./SelfCheckLog";
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
    // Error message from the most recent failed refresh, or null when the last
    // refresh succeeded (or none has run yet). Surfaced so a refresh failure is
    // distinguishable from "the box has genuinely never run a self-check" —
    // both otherwise look identical (all-null selfCheck).
    lastError: string | null;
};

const VERSION: string = (packageJson as { version?: string }).version ?? "unknown";

// Pinned to globalThis because Next.js compiles API routes through its own
// bundler and gives them a separate module instance from the one loaded by tsx
// for server.ts. A module-level `let snapshot` ends up duplicated: the
// background refresh writes to the tsx copy, while /api/health reads from a
// pristine route copy and therefore always returns the initial all-null value.
// globalThis is the single process-wide object both copies share. (Metrics.ts
// hit and fixed this exact trap — keep the two in sync.)
const STATE_KEY = "__yundera_health_state__" as const;

interface HealthState {
    snapshot: HealthSnapshot;
    refreshTimer: NodeJS.Timeout | null;
}

function getState(): HealthState {
    const g = globalThis as unknown as Record<string, HealthState | undefined>;
    let s = g[STATE_KEY];
    if (!s) {
        s = {
            snapshot: {
                version: VERSION,
                selfCheck: { ok: null, lastRunAt: null, passed: null, total: null },
                lastRefreshedAt: null,
                lastError: null,
            },
            refreshTimer: null,
        };
        g[STATE_KEY] = s;
    }
    return s;
}

/**
 * Public read of the cached snapshot. Pure RAM lookup — safe to expose on a
 * public endpoint.
 */
export function getHealthSnapshot(): HealthSnapshot {
    return getState().snapshot;
}

/**
 * Reduce the most recent *completed* run in the tail to the flat shape the
 * public endpoint has always returned. A run still in flight is skipped —
 * /api/health reports the last verdict, not a partial one.
 *
 * Structural parsing lives in SelfCheckLog.ts, shared with the admin summary
 * endpoint so the two views cannot disagree. Both `passed`/`total` stay null
 * when the run window can't be trusted (start line outside the tail) or when
 * no result lines were found, rather than reporting a misleading 0/0.
 */
function parseSelfCheckStatus(logTail: string): SelfCheckStatus {
    const run = latestCompletedSelfCheckRun(logTail);
    if (!run) return { ok: null, lastRunAt: null, passed: null, total: null };

    const countable = !run.truncated && run.total > 0;
    // The host writes timestamps in local time (no zone in the log). We can
    // only return what we have — emit the bare local timestamp so callers
    // don't get a falsely-precise UTC value.
    return {
        ok: run.status === "success",
        lastRunAt: run.endedAt,
        passed: countable ? run.passed : null,
        total: countable ? run.total : null,
    };
}

/**
 * Refresh the cached snapshot by reading the host log over SSH.
 * On failure we keep the previous selfCheck rather than blanking it on a
 * transient SSH hiccup, but record the error in `lastError` so the failure is
 * visible to callers instead of silently swallowed.
 */
export async function refreshHealthSnapshot(): Promise<void> {
    const state = getState();
    try {
        const result = await executeHostCommand(
            `tail -n ${LOG_TAIL_LINES} ${LOG_FILE}`
        );
        const selfCheck = parseSelfCheckStatus(result.stdout || "");
        state.snapshot = {
            version: VERSION,
            selfCheck,
            lastRefreshedAt: new Date().toISOString(),
            lastError: null,
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(
            "Health: failed to refresh self-check status from host log:",
            message
        );
        state.snapshot = { ...state.snapshot, lastError: message };
    }
}

/**
 * Kick off the first refresh and arm the periodic timer. Idempotent.
 */
export function startHealthRefresh(): void {
    const state = getState();
    if (state.refreshTimer) {
        return;
    }
    void refreshHealthSnapshot();
    state.refreshTimer = setInterval(() => {
        void refreshHealthSnapshot();
    }, REFRESH_INTERVAL_MS);
    // Don't keep the event loop alive just for this timer.
    state.refreshTimer.unref?.();
}
