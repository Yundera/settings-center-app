import { execOnTarget, MigrationKeyPair, shq } from '../MigrationSSH';

/**
 * Pre-cutover validation. Runs AFTER start_user_apps (target stack is up
 * end-to-end on the new host) and BEFORE switchover / webhook (source has
 * not yet gone silent). The point is to fail loudly here — while the
 * source is still serving and the migration is recoverable — rather than
 * during the orchestrator's post-cutover `waitForDomainReady`, which fires
 * after source has been soft-deleted and rollback is no longer cheap.
 *
 * Two checks:
 *   1. HTTPS probe of the target's IP with the user's domain in the
 *      Host header. This validates that the target's mesh-router-caddy /
 *      casaos chain serves real content for `<domain>` — independent of
 *      DNS / CF / gateway routing (since DNS still resolves to source at
 *      this point).
 *   2. Backend route lookup at `https://<serverDomain>/router/api/resolve/v2/<domainName>`.
 *      The target's mesh-router-agent should have registered its public IP
 *      against the user's domain when it started up during target_self_check.
 *      A response that includes the target IP means "external traffic will
 *      route here once source's agent drops out."
 *
 * Both probes run from the SOURCE host (via execOnTarget — same SSH path
 * as the rest of the migration). The source is the closest verifiable
 * vantage point and has network access to both the target IP and the
 * backend.
 */

export interface VerifyDestinationResult {
    ok: boolean;
    /** Human-readable summary suitable for step.message. */
    summary: string;
    /** Details for failure diagnosis. */
    httpOk: boolean;
    httpStatus?: number;
    httpError?: string;
    backendOk: boolean;
    backendRoutes?: Array<{ip?: string; domain?: string; port?: number; priority?: number; type?: string}>;
    backendError?: string;
}

export async function verifyDestination(
    keypair: MigrationKeyPair,
    target: string,
    domain: string,
    serverDomain: string,
): Promise<VerifyDestinationResult> {
    const domainFqdn = serverDomain ? `${domain}.${serverDomain}` : domain;

    // ---- 1. Direct HTTPS probe of the target IP with the right Host header.
    //         `--resolve` pins the FQDN to the target's IP regardless of the
    //         source host's DNS (which still points at source). `-k` because
    //         the target's cert at this stage may not yet match the FQDN.
    //         `-w '%{http_code}'` so we get the status code on stdout even
    //         when the body is empty. Times out at 10s — if the target's
    //         caddy isn't answering for the user's domain by now, there's no
    //         point waiting.
    const probeCmd =
        `curl -s -k -o /dev/null -w '%{http_code}' ` +
        `--connect-timeout 5 --max-time 10 ` +
        `--resolve ${shq(`${domainFqdn}:443:${target}`)} ` +
        `${shq(`https://${domainFqdn}/`)}`;
    let httpOk = false;
    let httpStatus: number | undefined;
    let httpError: string | undefined;
    try {
        const out = await execOnTarget(keypair, target, probeCmd);
        const code = parseInt(out.stdout.trim(), 10);
        httpStatus = Number.isFinite(code) ? code : undefined;
        // Any 2xx/3xx/4xx (other than CF / proxy errors) means the target's
        // caddy answered for the right vhost. 5xx with no body / 000 (curl
        // can't connect) means the path is broken.
        httpOk = httpStatus != null && httpStatus > 0 && httpStatus < 500;
    } catch (err) {
        httpError = err instanceof Error ? err.message : String(err);
    }

    // ---- 2. Backend route lookup. The mesh-router-backend resolves the
    //         domain name (not the FQDN) to a list of registered routes.
    //         We're looking for ANY route that mentions the target IP —
    //         the dash-form sslip.io / nip.io routes also carry it.
    const backendCmd =
        `curl -s --connect-timeout 5 --max-time 10 ` +
        `${shq(`https://${serverDomain}/router/api/resolve/v2/${domain}`)}`;
    let backendOk = false;
    let backendRoutes: VerifyDestinationResult['backendRoutes'];
    let backendError: string | undefined;
    try {
        const out = await execOnTarget(keypair, target, backendCmd);
        const body = (out.stdout || '').trim();
        if (!body) {
            backendError = 'empty backend response';
        } else {
            const parsed = JSON.parse(body);
            backendRoutes = Array.isArray(parsed?.routes) ? parsed.routes : [];
            // Look for the target IP anywhere in the routes — `ip` field for
            // direct routes, embedded in `domain` (e.g. 1-2-3-4.sslip.io)
            // for DNS-tunnel routes.
            const ipDash = target.replace(/\./g, '-');
            backendOk = (backendRoutes || []).some(r =>
                r.ip === target ||
                (typeof r.domain === 'string' && r.domain.includes(ipDash)),
            );
        }
    } catch (err) {
        backendError = err instanceof Error ? err.message : String(err);
    }

    const ok = httpOk && backendOk;
    const summary = (() => {
        const httpPart = httpOk
            ? `${domainFqdn} responds (HTTP ${httpStatus}) on target ${target}`
            : `${domainFqdn} did NOT respond on target ${target}` +
              (httpStatus != null ? ` (HTTP ${httpStatus})` : '') +
              (httpError ? ` — ${httpError}` : '');
        const backendPart = backendOk
            ? `${serverDomain} backend route points at ${target}`
            : `${serverDomain} backend route does NOT yet include ${target}` +
              (backendError ? ` — ${backendError}` : '');
        return `${httpPart} · ${backendPart}`;
    })();

    return { ok, summary, httpOk, httpStatus, httpError, backendOk, backendRoutes, backendError };
}
