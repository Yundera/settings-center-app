import { execOnTarget, MigrationKeyPair, shq } from '../MigrationSSH';

/**
 * Post-cutover verification. Runs AFTER `deregister_source` — the source's
 * mesh-router-agent is already stopped, so the `domain → IP` record is
 * uncontested and this check observes a settled route, not a flapping one.
 * It runs BEFORE `cleanup` / `source_down`, so a failure here still rolls
 * back cheaply (the source's stack is only stopped, not destroyed).
 *
 * TWO HARD GATES — the migration fails (→ rollback) unless BOTH pass:
 *
 *  1. Admin app health — HTTPS probe of the destination's admin app health
 *     endpoint (`https://admin-<domain>/api/health`, vhost pinned to the
 *     destination IP via `--resolve`, `-k`). A `/api/health` JSON payload
 *     proves caddy routes the admin vhost to the admin container rather than
 *     to the catch-all / claim page, and that the box's last self-check did
 *     not report failures. This is the authoritative gate — the migration is
 *     only complete once the destination's admin app verifies healthy.
 *
 *  2. Backend route resolution — backend route lookup at
 *     `https://<serverDomain>/router/api/resolve/v2/<domainName>`. Confirms
 *     mesh-router-backend resolves the user's domain to the destination's IP.
 *     The admin probe above is pinned to the destination IP via `--resolve`,
 *     so on its own it cannot prove public traffic now flows to the
 *     destination — this gate does. With the source already deregistered the
 *     destination is the sole publisher, so this resolves within a heartbeat
 *     or two.
 *
 * Both probes run on the target (via execOnTarget) — the closest verifiable
 * vantage point, with network access to itself and the public backend.
 */

// Minutes, not hours: the route is uncontested (the source is already
// deregistered), so this only waits out the destination agent's normal
// registration latency (backend healthcheck → public-IP detect → cert
// request → first registerRoutes; ~10–60s on a clean run). A definitively-
// unhealthy admin (failed self-check) short-circuits the loop early via
// `fatal` — see below — and fails the migration without burning the deadline.
const POLL_DEADLINE_MS = 5 * 60 * 1000;
const POLL_INTERVAL_MS = 10_000;

export interface VerifyDestinationResult {
    ok: boolean;
    /** Human-readable summary suitable for step.message. */
    summary: string;
    /** How long we polled before settling on this result. */
    waitedMs: number;
    /** Details for failure diagnosis. */
    adminOk: boolean;
    adminStatus?: number;
    /** selfCheck.ok from /api/health — true / null accepted, false rejected. */
    adminSelfCheck?: boolean | null;
    adminError?: string;
    backendOk: boolean;
    backendRoutes?: Array<{ip?: string; domain?: string; port?: number; priority?: number; type?: string}>;
    backendError?: string;
}

interface AdminHealthProbe {
    ok: boolean;
    /**
     * Definitively unhealthy — stop polling immediately rather than burning
     * the full poll deadline. Set only when the target's admin app is
     * reachable and explicitly reports a failed self-check; transient
     * conditions (container still starting, catch-all before caddy picks up
     * the route) are NOT fatal so they keep polling. A `fatal` admin probe
     * breaks the verify loop and fails the migration.
     */
    fatal: boolean;
    status?: number;
    selfCheck?: boolean | null;
    error?: string;
}

interface BackendProbe {
    ok: boolean;
    routes?: VerifyDestinationResult['backendRoutes'];
    error?: string;
}

/**
 * Probe the target's admin app health endpoint. A 200 carrying the expected
 * `/api/health` JSON means caddy on the target routes the `admin-<domain>`
 * vhost to the admin container AND the admin app reports the box healthy.
 * Anything else — non-200, non-JSON (catch-all / claim page), unrecognised
 * payload, or `selfCheck.ok === false` — fails the probe.
 */
async function probeAdminHealth(
    keypair: MigrationKeyPair,
    target: string,
    adminFqdn: string,
): Promise<AdminHealthProbe> {
    // `--resolve` pins admin-<domain> to the target's IP regardless of DNS.
    // `-k` because the target serves the admin vhost under the custom CA.
    // `-w` appends the HTTP status on its own marked line so we read body +
    // status from a single curl. `|| true` so a connection failure (curl
    // exit 7/28) still yields the status line instead of throwing.
    const cmd =
        `curl -s -k -w '\\n__HTTP_STATUS__:%{http_code}' ` +
        `--connect-timeout 5 --max-time 10 ` +
        `--resolve ${shq(`${adminFqdn}:443:${target}`)} ` +
        `${shq(`https://${adminFqdn}/api/health`)} || true`;

    let raw: string;
    try {
        const out = await execOnTarget(keypair, target, cmd);
        raw = out.stdout ?? '';
    } catch (err) {
        // SSH-level failure (target host unreachable) — transient, keep polling.
        return { ok: false, fatal: false, error: err instanceof Error ? err.message : String(err) };
    }

    const m = raw.match(/__HTTP_STATUS__:(\d+)\s*$/);
    const status = m ? parseInt(m[1], 10) : undefined;
    const body = (m ? raw.slice(0, m.index) : raw).replace(/\n$/, '').trim();

    if (status !== 200) {
        // 000 = no answer (admin container still starting / sshd blip) — transient.
        return {
            ok: false,
            fatal: false,
            status,
            error: status
                ? `admin /api/health returned HTTP ${status}`
                : 'admin /api/health unreachable (no HTTP response)',
        };
    }

    // A 200 that is NOT the admin health JSON means caddy routed the request
    // somewhere else — the catch-all (CasaOS welcome) or a claim page answers
    // 200 with HTML. Requiring the structured payload is what makes this
    // probe reject the mis-routing a bare `< 500` check silently passed.
    let parsed: { version?: unknown; selfCheck?: { ok?: unknown } };
    try {
        parsed = JSON.parse(body);
    } catch {
        return {
            ok: false,
            fatal: false,
            status,
            error: 'admin /api/health returned non-JSON — vhost is hitting the catch-all / claim page, not the admin app',
        };
    }
    if (typeof parsed?.version !== 'string' || typeof parsed?.selfCheck !== 'object' || parsed.selfCheck === null) {
        return {
            ok: false,
            fatal: false,
            status,
            error: 'admin /api/health payload not recognised — wrong app behind the admin- vhost?',
        };
    }

    // selfCheck.ok is true | false | null. `null` = no completion line
    // observed yet (a freshly-started admin container may not have refreshed
    // its cache) — tolerated. `false` = the target's last self-check ran and
    // found failures — rejected, and fatal since polling cannot change it.
    const selfCheck: boolean | null =
        parsed.selfCheck.ok === true || parsed.selfCheck.ok === false ? parsed.selfCheck.ok : null;

    if (selfCheck === false) {
        return {
            ok: false,
            fatal: true,
            status,
            selfCheck,
            error: 'target admin reports the last self-check completed WITH FAILURES',
        };
    }

    return { ok: true, fatal: false, status, selfCheck };
}

async function probeBackend(
    keypair: MigrationKeyPair,
    target: string,
    domain: string,
    serverDomain: string,
): Promise<BackendProbe> {
    const cmd =
        `curl -s --connect-timeout 5 --max-time 10 ` +
        `${shq(`https://${serverDomain}/router/api/resolve/v2/${domain}`)}`;
    try {
        const out = await execOnTarget(keypair, target, cmd);
        const body = (out.stdout || '').trim();
        if (!body) return { ok: false, error: 'empty backend response' };
        const parsed = JSON.parse(body);
        const routes: NonNullable<VerifyDestinationResult['backendRoutes']> =
            Array.isArray(parsed?.routes) ? parsed.routes : [];
        // Match the target IP anywhere in the routes — `ip` field for
        // direct routes, embedded in `domain` (e.g. 1-2-3-4.sslip.io) for
        // nip.io/sslip.io routes registered by the agent.
        const ipDash = target.replace(/\./g, '-');
        const ok = routes.some(r =>
            r.ip === target ||
            (typeof r.domain === 'string' && r.domain.includes(ipDash)),
        );
        return { ok, routes };
    } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export async function verifyDestination(
    keypair: MigrationKeyPair,
    target: string,
    domain: string,
    serverDomain: string,
): Promise<VerifyDestinationResult> {
    const domainFqdn = serverDomain ? `${domain}.${serverDomain}` : domain;
    // The admin app is published at `admin-<DOMAIN>` (see the `caddy_0:
    // admin-${DOMAIN}` label on the admin service in template-root's
    // docker-compose.yml).
    const adminFqdn = `admin-${domainFqdn}`;
    const startedAt = Date.now();

    let admin: AdminHealthProbe = { ok: false, fatal: false };
    let backend: BackendProbe = { ok: false };
    let attempt = 0;

    while (true) {
        attempt++;
        // Both the admin health probe and the backend route are HARD gates;
        // each re-runs until it passes. A `fatal` admin probe (failed
        // self-check) can never pass, so it short-circuits the loop.
        if (!backend.ok) backend = await probeBackend(keypair, target, domain, serverDomain);
        if (!admin.ok && !admin.fatal) admin = await probeAdminHealth(keypair, target, adminFqdn);

        if (backend.ok && admin.ok) break;  // both hard gates satisfied
        if (admin.fatal) break;             // admin definitively unhealthy — cannot pass
        if (Date.now() - startedAt >= POLL_DEADLINE_MS) break;
        await sleep(POLL_INTERVAL_MS);
    }

    const waitedMs = Date.now() - startedAt;
    // Both the admin app health and the backend route are hard gates — the
    // admin app health is the authoritative one (see the file header).
    const ok = admin.ok && backend.ok;

    const waitedPart = waitedMs >= POLL_INTERVAL_MS
        ? ` (after ${Math.round(waitedMs / 1000)}s, ${attempt} attempts)`
        : '';
    const backendPart = backend.ok
        ? `${serverDomain} backend route points at ${target}`
        : `${serverDomain} backend route does NOT include ${target}` +
          (backend.error ? ` — ${backend.error}` : '');
    const adminPart = admin.ok
        ? `admin app healthy on ${target} (self-check ${admin.selfCheck === true ? 'OK' : 'not yet reported'})`
        : `admin app NOT verified on ${target}` +
          (admin.status != null ? ` (HTTP ${admin.status})` : '') +
          (admin.error ? ` — ${admin.error}` : '');
    const summary = `${backendPart} · ${adminPart}${waitedPart}`;

    return {
        ok,
        summary,
        waitedMs,
        adminOk: admin.ok,
        adminStatus: admin.status,
        adminSelfCheck: admin.selfCheck,
        adminError: admin.error,
        backendOk: backend.ok,
        backendRoutes: backend.routes,
        backendError: backend.error,
    };
}
