import fs from 'fs';
import path from 'path';
import {getConfig} from '@/configuration/getConfigBackend';

/**
 * Per-account session generation counter — the thing that makes "Revoke"
 * actually revoke.
 *
 * `admin_session` is a self-contained JWT with a 24h TTL and no server-side
 * store, so deleting an account only stopped NEW logins: an already-issued
 * token stayed valid for the rest of the day. For a revoked administrator that
 * meant terminal, SSH-key management and reboot kept working long after access
 * was withdrawn.
 *
 * Every issued token carries the account's epoch at issue time. Bumping the
 * epoch invalidates every token issued before the bump, immediately and without
 * a round trip on the read path.
 *
 * PER-ACCOUNT, not global, on purpose: a global counter would sign the admin
 * out of their own dashboard the moment they revoked somebody else.
 *
 * Storage lives beside admin-session-key in /app/data — the app's own writable
 * state, deliberately NOT the stack directory, which template-root rsyncs with
 * --delete (see sessionKey.ts). Held in memory and written through; a PCS runs
 * exactly one admin container, so there is no second writer to reconcile with.
 *
 * A missing entry means epoch 0, which is also what a token with no `epoch`
 * claim is read as. That is what keeps sessions issued before this feature
 * shipped valid across the deploy instead of signing the whole fleet out.
 */

const DEFAULT_PATH = '/app/data/session-epochs.json';

type EpochMap = Record<string, number>;

let cache: EpochMap | null = null;

function filePath(): string {
    return getConfig('SESSION_EPOCH_PATH') || DEFAULT_PATH;
}

function load(): EpochMap {
    if (cache) return cache;
    const p = filePath();
    try {
        if (fs.existsSync(p)) {
            const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                cache = parsed as EpochMap;
                return cache;
            }
        }
    } catch (err) {
        // A corrupt file must not lock everyone out. Treat it as empty: every
        // epoch reads as 0, existing sessions keep working, and the next bump
        // rewrites the file cleanly.
        console.warn(`[sessionEpoch] cannot read ${p}: ${String(err)}. Treating all epochs as 0.`);
    }
    cache = {};
    return cache;
}

function persist(map: EpochMap): void {
    const p = filePath();
    try {
        fs.mkdirSync(path.dirname(p), {recursive: true});
        // Write-then-rename so a crash mid-write cannot leave a truncated file
        // that would silently reset every epoch to 0 and un-revoke sessions.
        const tmp = `${p}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(map), {mode: 0o600});
        fs.renameSync(tmp, p);
    } catch (err) {
        // Log loudly: the in-memory bump still applies for this process, so
        // revocation works until restart, but it will not survive one.
        console.error(`[sessionEpoch] FAILED to persist ${p}: ${String(err)}. Revocations will not survive a restart.`);
    }
}

/** Current epoch for an account. Unknown accounts are 0. */
export function currentEpoch(username: string): number {
    const map = load();
    return map[username] ?? 0;
}

/**
 * Invalidate every session already issued for this account.
 *
 * Call after any change that should end existing sessions — deleting the
 * account, resetting its password, or changing what it is allowed to do.
 * Adding a user or editing their email does not need it.
 */
export function bumpEpoch(username: string): number {
    const map = load();
    const next = (map[username] ?? 0) + 1;
    map[username] = next;
    persist(map);
    return next;
}
