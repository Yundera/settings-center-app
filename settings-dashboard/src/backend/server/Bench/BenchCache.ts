// Single-flight, cooldown-gated RAM cache for the disk / network benchmarks.
//
// Public `/api/bench/*` endpoints sit in front of this cache so they can stay
// open without being a DoS amplifier:
//   • a request only triggers a bench when none is in flight AND at least
//     TRIGGER_COOLDOWN_MS has elapsed since the last ATTEMPT (success or
//     failure). `lastAttemptAt` is stamped the moment a run starts, so the
//     public path can start at most one bench per cooldown window — even if
//     every run fails (a failed run leaves `result` null, but the cooldown,
//     not the cached result, is what gates re-triggering).
//   • concurrent requests during a run share the same in-flight promise.
//   • the response is non-blocking: callers immediately see
//     {status:"pending"} while a bench is running, and poll for the result.
//   • the auth-gated /api/admin/resources/* endpoints call the runners
//     directly and are NOT subject to the cooldown — they are the
//     on-demand refresh route for an authenticated admin.
//
// State lives in RAM only — the lifecycle is the admin container. A restart
// re-arms the lazy trigger on the next public poll. Pinned to globalThis for
// the same reason as Metrics: Next.js dev mode bundles API routes through a
// separate module instance, and we need every copy to see the same cache.

import { runDiskBench, runNetworkBench, type DiskTestResult, type NetworkTestResult } from "./runners";

// Minimum gap between public-path bench triggers, measured from the start of
// the previous attempt (win or fail). Caps the host work an unauthenticated
// caller can initiate to one disk + one network run per window per process.
// A disk run is ~256 MiB of IO (≤90 s) and a network run ~50 MiB of transfer
// (≤150 s), so 10 min keeps the worst-case public-initiated load negligible
// while still letting `pcs perf` refresh stale numbers on demand.
const TRIGGER_COOLDOWN_MS = 10 * 60_000;

export type BenchStatus = "pending" | "ok" | "error";

export interface BenchEntry<T> {
    status: BenchStatus;
    /** Last successful result, or null until one completes. */
    result: T | null;
    /** ISO timestamp of the last successful run. */
    ranAt: string | null;
    /** ISO timestamp when the in-flight run started, if any. */
    pendingSince: string | null;
    /** Error message from the most recent failed run, cleared on success. */
    error: string | null;
}

interface BenchSlot<T> {
    entry: BenchEntry<T>;
    inFlight: Promise<T> | null;
    /** epoch ms of the last triggered attempt (success or failure); gates the
     *  public-path cooldown. null until the first attempt starts. */
    lastAttemptAt: number | null;
}

interface BenchState {
    disk: BenchSlot<DiskTestResult>;
    network: BenchSlot<NetworkTestResult>;
}

const STATE_KEY = "__yundera_bench_state__" as const;

function makeSlot<T>(): BenchSlot<T> {
    return {
        entry: {
            status: "pending",
            result: null,
            ranAt: null,
            pendingSince: null,
            error: null,
        },
        inFlight: null,
        lastAttemptAt: null,
    };
}

function getState(): BenchState {
    const g = globalThis as unknown as Record<string, BenchState | undefined>;
    let s = g[STATE_KEY];
    if (!s) {
        s = { disk: makeSlot<DiskTestResult>(), network: makeSlot<NetworkTestResult>() };
        g[STATE_KEY] = s;
    }
    return s;
}

function snapshot<T>(slot: BenchSlot<T>): BenchEntry<T> {
    return { ...slot.entry };
}

/**
 * Whether a public-path call may start a run for this slot: nothing in flight,
 * and the cooldown since the last attempt (win or fail) has elapsed. This — not
 * the presence of a cached result — is what bounds public-initiated host work,
 * so a slot whose runs keep failing still can't be hammered.
 */
function canTrigger<T>(slot: BenchSlot<T>): boolean {
    if (slot.inFlight) return false;
    if (slot.lastAttemptAt === null) return true;
    return Date.now() - slot.lastAttemptAt >= TRIGGER_COOLDOWN_MS;
}

function trigger<T>(slot: BenchSlot<T>, runner: () => Promise<T>): void {
    if (slot.inFlight) return;
    slot.lastAttemptAt = Date.now();
    slot.entry.pendingSince = new Date().toISOString();
    slot.entry.status = slot.entry.result ? "ok" : "pending";
    slot.inFlight = runner()
        .then(result => {
            slot.entry.result = result;
            slot.entry.ranAt = result && typeof (result as any).ranAt === "string"
                ? (result as any).ranAt
                : new Date().toISOString();
            slot.entry.status = "ok";
            slot.entry.error = null;
            return result;
        })
        .catch(err => {
            const msg = err instanceof Error ? err.message : String(err);
            slot.entry.error = msg;
            // Keep the previous result if there was one — a single failed
            // refresh shouldn't clear known-good data. Status reflects the
            // newest signal so callers can see something broke.
            slot.entry.status = slot.entry.result ? "ok" : "error";
            throw err;
        })
        .finally(() => {
            slot.entry.pendingSince = null;
            slot.inFlight = null;
        });
    // Swallow the rejection at the top level — the promise above is for the
    // first caller awaiting the in-flight chain, not for the background
    // single-flight. Without this, an unhandled rejection logs every failure.
    slot.inFlight.catch(() => {});
}

/**
 * Return the cached disk-bench entry. If the cooldown has elapsed and no run
 * is in flight, kick one off in the background. Never blocks the caller.
 */
export function getDiskBench(): BenchEntry<DiskTestResult> {
    const slot = getState().disk;
    if (canTrigger(slot)) {
        trigger(slot, runDiskBench);
    }
    return snapshot(slot);
}

/** Same as getDiskBench but for the network bench. */
export function getNetworkBench(): BenchEntry<NetworkTestResult> {
    const slot = getState().network;
    if (canTrigger(slot)) {
        trigger(slot, runNetworkBench);
    }
    return snapshot(slot);
}
