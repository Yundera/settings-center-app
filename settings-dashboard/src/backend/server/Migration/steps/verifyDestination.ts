import { execOnTarget, MigrationKeyPair, shq } from '../MigrationSSH';

/**
 * Pre-cutover validation. Runs AFTER start_user_apps (target stack is up
 * end-to-end on the new host) and BEFORE switchover / webhook (source has
 * not yet gone silent). The point is to fail loudly here — while the
 * source is still serving and the migration is recoverable — rather than
 * during the orchestrator's post-cutover `waitForDomainReady`, which fires
 * after source has been soft-deleted and rollback is no longer cheap.
 *
 * Two checks, polled until both pass or the deadline elapses:
 *   1. HTTPS probe of the target's IP with the user's domain in the
 *      Host header. This validates that the target's mesh-router-caddy /
 *      casaos chain serves real content for `<domain>` — independent of
 *      DNS / CF / gateway routing (since DNS still resolves to source at
 *      this point).
 *   2. Backend route lookup at `https://<serverDomain>/router/api/resolve/v2/<domainName>`.
 *      The target's mesh-router-agent registers asynchronously after the
 *      system stack comes up (backend healthcheck → public-IP detect →
 *      cert request → first registerRoutes). On a clean run this completes
 *      in ~10–60s; with a transient blip the agent backs off for
 *      ERROR_RETRY_INTERVAL (default 600s) before retrying. The poll
 *      deadline below is set generously so the worst-case (multiple agent
 *      retry windows + at least one backend TTL refresh) still resolves
 *      to success rather than triggering rollback for what is in practice
 *      an eventually-consistent registration.
 *
 * Both probes run on the target (via execOnTarget — same SSH path as the
 * rest of the migration). The target is the closest verifiable vantage
 * point and has network access to both itself and the public backend.
 */

// 3 hours total. Backend route TTL is at least 10 min and agent retries on
// error every 10 min, so 3h gives the agent ~17 retry windows + lets a
// stuck TTL expire and re-register at least once. Earlier (2 min) the
// budget was tuned to "fail loudly when the worst case hits"; experience
// showed the worst case is just slower-than-expected agent startup that
// would have succeeded with another 30s of patience, so fail-loud was
// costing us false rollbacks.
const POLL_DEADLINE_MS = 3 * 60 * 60 * 1000;
const POLL_INTERVAL_MS = 15_000;

export interface VerifyDestinationResult {
    ok: boolean;
    /** Human-readable summary suitable for step.message. */
    summary: string;
    /** How long we polled before settling on this result. */
    waitedMs: number;
    /** Details for failure diagnosis. */
    httpOk: boolean;
    httpStatus?: number;
    httpError?: string;
    backendOk: boolean;
    backendRoutes?: Array<{ip?: string; domain?: string; port?: number; priority?: number; type?: string}>;
    backendError?: string;
}

interface HttpProbe {
    ok: boolean;
    status?: number;
    error?: string;
}

interface BackendProbe {
    ok: boolean;
    routes?: VerifyDestinationResult['backendRoutes'];
    error?: string;
}

async function probeHttp(
    keypair: MigrationKeyPair,
    target: string,
    domainFqdn: string,
): Promise<HttpProbe> {
    // `--resolve` pins the FQDN to the target's IP regardless of the
    // target host's own DNS. `-k` because the target's cert at this stage
    // may not yet match the FQDN. `-w '%{http_code}'` so we get the status
    // code on stdout even when the body is empty.
    const cmd =
        `curl -s -k -o /dev/null -w '%{http_code}' ` +
        `--connect-timeout 5 --max-time 10 ` +
        `--resolve ${shq(`${domainFqdn}:443:${target}`)} ` +
        `${shq(`https://${domainFqdn}/`)}`;
    try {
        const out = await execOnTarget(keypair, target, cmd);
        const code = parseInt(out.stdout.trim(), 10);
        const status = Number.isFinite(code) ? code : undefined;
        // 2xx/3xx/4xx (anything < 500) means caddy answered for the right
        // vhost. 5xx / 000 means the path is broken.
        const ok = status != null && status > 0 && status < 500;
        return { ok, status };
    } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
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
        const routes: VerifyDestinationResult['backendRoutes'] =
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
    const startedAt = Date.now();

    let http: HttpProbe = { ok: false };
    let backend: BackendProbe = { ok: false };
    let attempt = 0;

    while (true) {
        attempt++;
        // Re-probe whichever check hasn't yet succeeded. Once a check
        // passes, freeze it — agent registration only goes one way during
        // this window, and re-probing risks a flap (e.g. source's agent
        // re-registers and clobbers the route briefly).
        if (!http.ok) http = await probeHttp(keypair, target, domainFqdn);
        if (!backend.ok) backend = await probeBackend(keypair, target, domain, serverDomain);

        if (http.ok && backend.ok) break;
        if (Date.now() - startedAt >= POLL_DEADLINE_MS) break;
        await sleep(POLL_INTERVAL_MS);
    }

    const waitedMs = Date.now() - startedAt;
    const ok = http.ok && backend.ok;

    const waitedPart = waitedMs >= POLL_INTERVAL_MS
        ? ` (after ${Math.round(waitedMs / 1000)}s, ${attempt} attempts)`
        : '';
    const httpPart = http.ok
        ? `${domainFqdn} responds (HTTP ${http.status}) on target ${target}`
        : `${domainFqdn} did NOT respond on target ${target}` +
          (http.status != null ? ` (HTTP ${http.status})` : '') +
          (http.error ? ` — ${http.error}` : '');
    const backendPart = backend.ok
        ? `${serverDomain} backend route points at ${target}`
        : `${serverDomain} backend route does NOT yet include ${target}` +
          (backend.error ? ` — ${backend.error}` : '');
    const summary = `${httpPart} · ${backendPart}${waitedPart}`;

    return {
        ok,
        summary,
        waitedMs,
        httpOk: http.ok,
        httpStatus: http.status,
        httpError: http.error,
        backendOk: backend.ok,
        backendRoutes: backend.routes,
        backendError: backend.error,
    };
}
