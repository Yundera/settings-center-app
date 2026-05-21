import { MigrationStatus } from './MigrationTypes';

/**
 * Pushes full MigrationStatus snapshots to the orchestrator throughout a
 * migration. Replaces the old one-shot webhook: progress, heartbeat and the
 * terminal signal are all the same POST to the same URL
 * (POST /pcs/migration-callback?token=…). The orchestrator reads `.phase`;
 * a terminal phase (done / failed / rolled_back) triggers promote or failure
 * handling on its side.
 *
 * After `deregister_source` the source is no longer reachable through its
 * own domain, so this outbound push is the ONLY channel by which status
 * reaches the orchestrator and the dashboard. It deliberately does not
 * depend on the source's mesh-router — a plain outbound HTTPS POST does not.
 */

/** Minimum gap between pushes — coalesces bursty step transitions + rsync. */
const MIN_INTERVAL_MS = 3_000;
/** Heartbeat: push even when nothing changed, so silence means "admin dead". */
const HEARTBEAT_MS = 15_000;
/** Per-request timeout. */
const TIMEOUT_MS = 8_000;

export interface StatusPusher {
    /** Schedule a coalesced push. Call after every state mutation. */
    notify(): void;
    /** Push the current snapshot immediately and stop the heartbeat. */
    flushTerminal(): Promise<void>;
    /** Stop the heartbeat without pushing. */
    stop(): void;
}

async function pushStatus(url: string, status: MigrationStatus): Promise<void> {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') {
        throw new Error(`status push URL must be HTTPS, got ${parsed.protocol}`);
    }
    // Strip webhookUrl — it carries the callback token, and the orchestrator
    // already has the token from the request URL; no need to echo it back.
    const snapshot: Record<string, unknown> = { ...status };
    delete snapshot.webhookUrl;
    const body = JSON.stringify(snapshot);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
            signal: controller.signal,
            redirect: 'manual',
        });
    } finally {
        clearTimeout(timer);
    }
}

/**
 * `url` undefined ⇒ no orchestrator callback configured (dev / Path A
 * without a callback URL): returns a no-op pusher so the pipeline runs
 * unchanged and the dashboard's manual "Complete migration" button drives
 * promotion.
 */
export function startStatusPusher(
    url: string | undefined,
    getStatus: () => MigrationStatus,
): StatusPusher {
    if (!url) {
        return { notify: () => {}, flushTerminal: async () => {}, stop: () => {} };
    }
    const target = url;
    let lastPushAt = 0;
    let pending: ReturnType<typeof setTimeout> | null = null;
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    let inFlight: Promise<void> = Promise.resolve();

    const doPush = (): Promise<void> => {
        lastPushAt = Date.now();
        inFlight = pushStatus(target, getStatus()).catch(err => {
            console.error('[Migration] status push failed:', err instanceof Error ? err.message : err);
        });
        return inFlight;
    };

    const notify = (): void => {
        if (pending) return; // a push is already scheduled
        const since = Date.now() - lastPushAt;
        if (since >= MIN_INTERVAL_MS) {
            void doPush();
        } else {
            pending = setTimeout(() => {
                pending = null;
                void doPush();
            }, MIN_INTERVAL_MS - since);
        }
    };

    const stop = (): void => {
        if (pending) { clearTimeout(pending); pending = null; }
        if (heartbeat) { clearInterval(heartbeat); heartbeat = null; }
    };

    const flushTerminal = async (): Promise<void> => {
        stop();
        await inFlight; // let any in-flight push settle first
        await doPush(); // push the terminal snapshot
    };

    heartbeat = setInterval(notify, HEARTBEAT_MS);

    return { notify, flushTerminal, stop };
}
