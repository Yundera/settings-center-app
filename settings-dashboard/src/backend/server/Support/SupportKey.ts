import { getConfig } from "@/configuration/getConfigBackend";

export interface SupportKey {
    algorithm: string;
    comment: string;
    publicKey: string;
    fingerprint: string;
}

let cached: { value: SupportKey; expiresAt: number } | null = null;
const TTL_MS = 5 * 60 * 1000;

/**
 * Fetches the orchestrator's public support SSH key.
 *
 * The orchestrator exposes this at GET /support/ssh-key as a public endpoint
 * (no auth required) — see pcs-orchestrator/src/service/supportAPI.ts. We
 * cache the response for a few minutes since the key only rotates when the
 * orchestrator restarts with a new SSH_KEY env.
 */
export async function fetchSupportKey(): Promise<SupportKey> {
    if (cached && Date.now() < cached.expiresAt) return cached.value;

    const base = getConfig("YUNDERA_API");
    if (!base) {
        throw new Error("YUNDERA_API not configured — cannot reach orchestrator");
    }
    const url = `${base.replace(/\/$/, "")}/support/ssh-key`;

    const res = await fetch(url);
    if (!res.ok) {
        throw new Error(`Orchestrator /support/ssh-key returned ${res.status}`);
    }
    const json = await res.json() as Partial<SupportKey>;
    if (!json.publicKey || !json.fingerprint || !json.algorithm) {
        throw new Error("Orchestrator returned malformed support key");
    }
    const value: SupportKey = {
        algorithm: json.algorithm,
        comment: json.comment || "yundera-support",
        publicKey: json.publicKey,
        fingerprint: json.fingerprint,
    };
    cached = { value, expiresAt: Date.now() + TTL_MS };
    return value;
}
