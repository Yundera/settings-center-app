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
};

export type HealthSnapshot = {
    version: string;
    selfCheck: SelfCheckStatus;
    lastRefreshedAt: string | null; // ISO 8601 of last successful refresh
};

const VERSION: string = (packageJson as { version?: string }).version ?? "unknown";

let snapshot: HealthSnapshot = {
    version: VERSION,
    selfCheck: { ok: null, lastRunAt: null },
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

/**
 * Parse a log tail and find the most recent self-check completion line.
 * Self-check.sh emits exactly one of these lines per run:
 *   [YYYY-MM-DD HH:MM:SS] [LEVEL] === Self-check completed successfully ===
 *   [YYYY-MM-DD HH:MM:SS] [LEVEL] === Self-check completed with failures ===
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
            // The host writes timestamps in local time (no zone in the log).
            // We can only return what we have — emit the bare local timestamp
            // so callers don't get a falsely-precise UTC value.
            return {
                ok: outcome === "successfully",
                lastRunAt: `${date}T${time}`,
            };
        }
    }
    return { ok: null, lastRunAt: null };
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
