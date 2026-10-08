import crypto from 'crypto';
import {exportJWK, generateKeyPair, KeyLike} from 'jose';

/**
 * One-time X25519 keys for the identity push (pcs-orchestrator
 * doc/identity-push.md, "Wire contract").
 *
 * The orchestrator fetches a key, encrypts the signed bundle to it, and posts
 * it back naming the key's `kid`. Each key lives in memory only, decrypts at
 * most one push, and expires after a short window — so the box keeps no
 * secret of its own, which is the whole point of the design.
 *
 * The routes are public, so the store is bounded: issuing a key is cheap, and
 * a flood can only evict other unused keys, never accumulate memory.
 */
const TTL_MS = 2 * 60_000;
const MAX_KEYS = 16;

interface Entry {
    privateKey: KeyLike;
    expiresAt: number;
}

const keys = new Map<string, Entry>();

function sweep(now: number): void {
    for (const [kid, e] of keys) if (e.expiresAt <= now) keys.delete(kid);
    // Map iteration is insertion order: drop the oldest first.
    while (keys.size >= MAX_KEYS) keys.delete(keys.keys().next().value as string);
}

export async function issueKey(): Promise<{kid: string; jwk: {kty: string; crv: string; x: string}}> {
    const now = Date.now();
    sweep(now);
    const {publicKey, privateKey} = await generateKeyPair('ECDH-ES', {crv: 'X25519'});
    const kid = crypto.randomUUID();
    keys.set(kid, {privateKey, expiresAt: now + TTL_MS});
    const jwk = await exportJWK(publicKey);
    return {kid, jwk: {kty: jwk.kty as string, crv: jwk.crv as string, x: jwk.x as string}};
}

/** Take (and forget) the key a push names. Null if unknown, used or expired. */
export function takeKey(kid: string): KeyLike | null {
    const e = keys.get(kid);
    keys.delete(kid);
    if (!e || e.expiresAt <= Date.now()) return null;
    return e.privateKey;
}
