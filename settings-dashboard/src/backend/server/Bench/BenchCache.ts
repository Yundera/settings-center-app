// Single-flight RAM cache for the disk / network benchmarks.
//
// Public `/api/bench/*` endpoints sit in front of this cache so they can stay
// open without being a DoS amplifier:
//   • first request with no cached value triggers ONE bench, all concurrent
//     requests share the same in-flight promise.
//   • once cached, the value is returned indefinitely — no public path
//     refreshes it. The auth-gated /api/admin/resources/* endpoints stay as
//     the manual-refresh route.
//   • the response is non-blocking: callers immediately see
//     {status:"pending"} while a bench is running, and poll for the result.
//
// State lives in RAM only — the lifecycle is the admin container. A restart
// re-arms the lazy trigger on the next public poll. Pinned to globalThis for
// the same reason as Metrics: Next.js dev mode bundles API routes through a
// separate module instance, and we need every copy to see the same cache.

import { runDiskBench, runNetworkBench, type DiskTestResult, type NetworkTestResult } from "./runners";

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

function trigger<T>(slot: BenchSlot<T>, runner: () => Promise<T>): void {
    if (slot.inFlight) return;
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
 * Return the cached disk-bench entry. If there is no result yet AND no run
 * is in flight, kick one off in the background. Never blocks the caller.
 */
export function getDiskBench(): BenchEntry<DiskTestResult> {
    const slot = getState().disk;
    if (!slot.entry.result && !slot.inFlight) {
        trigger(slot, runDiskBench);
    }
    return snapshot(slot);
}

/** Same as getDiskBench but for the network bench. */
export function getNetworkBench(): BenchEntry<NetworkTestResult> {
    const slot = getState().network;
    if (!slot.entry.result && !slot.inFlight) {
        trigger(slot, runNetworkBench);
    }
    return snapshot(slot);
}
