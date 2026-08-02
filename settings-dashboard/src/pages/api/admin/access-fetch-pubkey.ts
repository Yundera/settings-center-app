import { NextApiRequest, NextApiResponse } from 'next';
import { authMiddleware } from "@/backend/auth/middleware";
import { trustedPubkeyHostSuffixes } from "@/brand/resolveBrand";
import dns from 'dns';
import net from 'net';

// Hostnames (and any subdomain of these) we treat as operator-official. The
// UI surfaces this as a normal-tone "trusted source" instead of the
// orange "TLS-verified but unverified party" tone used for arbitrary
// HTTPS hosts.
//
// Sourced from the operator block in brand.json, and EMPTY when the PCS has
// no operator: with nobody to vouch for a host, nothing is official. It is
// deliberately not user-curatable — a user who could add entries could mark
// any host as vouched-for by the operator, which is exactly the assurance
// the badge exists to make.

const FETCH_TIMEOUT_MS = 10_000;
const MAX_BODY_BYTES = 64 * 1024;

const VALID_KEY_TYPE_RE = /^(ssh-(rsa|dss|ed25519)|ecdsa-sha2-nistp(256|384|521)|sk-(ssh-ed25519|ecdsa-sha2-nistp256)@openssh\.com)$/;

export interface FetchPubkeyResponse {
    url: string;
    hostname: string;
    trusted: boolean;
    type: string;
    publicKey: string;
    comment: string;
    fingerprint: string;
}

function isTrustedHostname(hostname: string): boolean {
    const h = hostname.toLowerCase();
    return trustedPubkeyHostSuffixes().some(s => h === s || h.endsWith('.' + s));
}

// Reject IPs that point inside the PCS / its private network. The endpoint
// runs auth-protected so the attacker has to be a logged-in dashboard user
// already, but blocking link-local / RFC1918 / loopback is still cheap
// SSRF defense — also keeps the feature honest about being an
// "external identity" check.
function isPrivateAddress(addr: string): boolean {
    const family = net.isIP(addr);
    if (family === 4) {
        const parts = addr.split('.').map(n => parseInt(n, 10));
        if (parts.length !== 4 || parts.some(p => Number.isNaN(p))) return true;
        const [a, b] = parts;
        if (a === 10) return true;
        if (a === 127) return true;
        if (a === 169 && b === 254) return true;
        if (a === 172 && b >= 16 && b <= 31) return true;
        if (a === 192 && b === 168) return true;
        if (a === 0) return true;
        if (a >= 224) return true; // multicast / reserved
        return false;
    }
    if (family === 6) {
        const lower = addr.toLowerCase();
        if (lower === '::1' || lower === '::') return true;
        if (lower.startsWith('fe80')) return true; // link-local
        if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique local
        if (lower.startsWith('::ffff:')) {
            return isPrivateAddress(lower.slice('::ffff:'.length));
        }
        return false;
    }
    return true;
}

async function resolveSafeHostname(hostname: string): Promise<void> {
    if (net.isIP(hostname)) {
        if (isPrivateAddress(hostname)) {
            throw new Error('URL points to a private/loopback address.');
        }
        return;
    }
    const records = await dns.promises.lookup(hostname, { all: true, verbatim: true });
    if (!records.length) {
        throw new Error(`Hostname ${hostname} did not resolve.`);
    }
    for (const r of records) {
        if (isPrivateAddress(r.address)) {
            throw new Error('URL resolves to a private/loopback address.');
        }
    }
}

function parseRawKeyLine(line: string): { type: string; b64: string; comment: string; full: string } | null {
    const trimmed = line.replace(/\r/g, '').trim();
    if (!trimmed || trimmed.startsWith('#')) return null;
    if (trimmed.includes('\n')) return null;
    const parts = trimmed.split(/\s+/);
    if (parts.length < 2) return null;
    const [type, b64, ...rest] = parts;
    if (!VALID_KEY_TYPE_RE.test(type)) return null;
    if (!/^[A-Za-z0-9+/=]+$/.test(b64)) return null;
    return { type, b64, comment: rest.join(' '), full: `${type} ${b64}${rest.length ? ' ' + rest.join(' ') : ''}` };
}

function extractKeyFromBody(body: string): { type: string; b64: string; comment: string; full: string } | null {
    const trimmed = body.trim();

    // Try JSON first — matches the orchestrator's /support/ssh-key shape:
    //   { algorithm, comment, publicKey, fingerprint }
    if (trimmed.startsWith('{')) {
        try {
            const json = JSON.parse(trimmed);
            const candidate = json.publicKey || json.public_key || json.key || json.sshKey || json.ssh_key;
            if (typeof candidate === 'string') {
                const parsed = parseRawKeyLine(candidate);
                if (parsed) return parsed;
            }
        } catch {
            // fall through to plaintext
        }
    }

    // Plaintext: take the first line that parses as an SSH public key.
    for (const line of trimmed.split('\n')) {
        const parsed = parseRawKeyLine(line);
        if (parsed) return parsed;
    }
    return null;
}

async function computeFingerprint(b64: string): Promise<string> {
    const { createHash } = await import('crypto');
    const buf = Buffer.from(b64, 'base64');
    const digest = createHash('sha256').update(buf).digest('base64').replace(/=+$/, '');
    return `SHA256:${digest}`;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const rawUrl = typeof req.query.url === 'string' ? req.query.url : '';
    if (!rawUrl) {
        return res.status(400).json({ error: 'Missing url query parameter' });
    }

    let url: URL;
    try {
        url = new URL(rawUrl);
    } catch {
        return res.status(400).json({ error: 'Malformed URL' });
    }
    if (url.protocol !== 'https:') {
        return res.status(400).json({ error: 'Only https:// URLs are accepted' });
    }
    if (url.username || url.password) {
        return res.status(400).json({ error: 'URLs with embedded credentials are not accepted' });
    }

    try {
        await resolveSafeHostname(url.hostname);
    } catch (err) {
        return res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }

    let response: Response;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
        response = await fetch(url.toString(), {
            method: 'GET',
            redirect: 'error',
            signal: controller.signal,
            headers: { 'Accept': 'text/plain, application/json;q=0.9, */*;q=0.5' },
        });
    } catch (err) {
        clearTimeout(timeout);
        const msg = err instanceof Error ? err.message : String(err);
        return res.status(502).json({ error: `Failed to reach ${url.hostname}: ${msg}` });
    }
    clearTimeout(timeout);

    if (!response.ok) {
        return res.status(502).json({ error: `${url.hostname} returned HTTP ${response.status}` });
    }

    let body: string;
    try {
        const reader = response.body?.getReader();
        if (!reader) {
            body = await response.text();
        } else {
            const chunks: Uint8Array[] = [];
            let received = 0;
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                if (value) {
                    received += value.byteLength;
                    if (received > MAX_BODY_BYTES) {
                        try { await reader.cancel(); } catch { /* ignore */ }
                        return res.status(502).json({ error: `Response from ${url.hostname} exceeded ${MAX_BODY_BYTES} bytes` });
                    }
                    chunks.push(value);
                }
            }
            body = Buffer.concat(chunks.map(c => Buffer.from(c))).toString('utf8');
        }
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return res.status(502).json({ error: `Failed to read response: ${msg}` });
    }

    const parsed = extractKeyFromBody(body);
    if (!parsed) {
        return res.status(502).json({ error: `${url.hostname} did not return a recognizable SSH public key` });
    }

    const fingerprint = await computeFingerprint(parsed.b64);
    const result: FetchPubkeyResponse = {
        url: url.toString(),
        hostname: url.hostname,
        trusted: isTrustedHostname(url.hostname),
        type: parsed.type,
        publicKey: parsed.full,
        comment: parsed.comment,
        fingerprint,
    };
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(result);
}

export default authMiddleware(handler);
