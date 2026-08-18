import {IncomingMessage, ServerResponse} from 'http';
import {readGateIdentity} from './gateIdentity';

// Paths that bypass the page-level gate. API routes that need auth wrap
// themselves (authMiddleware, or adminMiddleware for everything under
// /api/admin/); everything in this list is intentionally reachable without an
// identity.
//
// KEEP THIS IN SYNC WITH THE GATE. The AppShield sidecar in front of this app
// has its own ALLOWED_PATHS covering the same set — anything reachable here but
// not there is unreachable in practice, and anything reachable there but not
// here 302s to the login flow instead of answering. template-root's
// docker-compose.yml is the other half.
//
// This gate checks authentication only, never role — that is deliberate. A
// non-admin account must still be able to load the SPA, where App.tsx leaves it
// the Account panel and adminMiddleware 403s the rest.
const BYPASS_PREFIXES = [
  '/api/me',             // does its own session check
  '/api/health',         // public probe — the orchestrator polls it during
                         //   provisioning, BEFORE any credential exists on the
                         //   box, so it must never require one
  '/api/perf',           // public RAM-cached metrics snapshot (orchestrator `pcs perf`)
  '/api/brand',          // public brand config (name, logo, provider link).
                         //   Carries no secrets — see resolveBrand.ts.
  '/api/bench/',         // public disk/network bench cache (orchestrator `pcs perf`);
                         //   read-only snapshot + cooldown-gated lazy trigger,
                         //   so an unauthenticated caller can start at most one
                         //   bench per cooldown window (see BenchCache.ts)
  '/api/local/',         // loopback-only routes (orchestrator's Path C trigger,
                         //   source's migration-status poll) — gated by
                         //   `loopbackOnly` middleware on the handler itself.
                         //   Deliberately NOT in the gate's ALLOWED_PATHS: the
                         //   only legitimate callers run inside this container
                         //   and reach it over loopback, bypassing the gate
                         //   entirely, which is what keeps that trust path
                         //   independent of the login chain.
  '/_next/',             // Next.js runtime
  '/favicon',
  '/logo',
  '/robots.txt',
  '/manifest',
];

/**
 * Where to send a browser that arrives without an identity.
 *
 * This is the gate's endpoint, not ours: the gate starts the OIDC flow, and this
 * app no longer has a login page of its own. Reaching it means the request got
 * here without passing the gate's own check — normally impossible, since the
 * gate only proxies what it has authenticated. The realistic causes are a
 * mismatched ALLOWED_PATHS, a missing/rotated IDENTITY_ASSERTION_SECRET, or
 * something on the `pcs` network talking to this container directly.
 */
const GATE_LOGIN_PATH = '/nhl-auth/oidc/login';

function shouldBypass(pathname: string): boolean {
  return BYPASS_PREFIXES.some(p => pathname.startsWith(p));
}

/**
 * Run before Next.js's request handler. Returns true if the request has been
 * handled (a redirect or 401 was written) and Next.js should NOT process it.
 */
export async function applyAuthGate(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
): Promise<boolean> {
  if (shouldBypass(pathname)) return false;

  if (await readGateIdentity(req.headers)) return false;

  // Page request (no /api/ prefix): hand it back to the gate's login flow,
  // preserving the target.
  if (!pathname.startsWith('/api/')) {
    const search = req.url && req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
    const redirect = encodeURIComponent(pathname + search);
    res.statusCode = 302;
    res.setHeader('Location', `${GATE_LOGIN_PATH}?redirect=${redirect}`);
    res.end();
    return true;
  }

  // Unauthenticated API hit that isn't in the bypass list. We do not let it
  // reach the handler — short-circuit with 401 JSON so the SPA's checkError
  // path triggers cleanly. (Handlers that wrap authMiddleware would do the
  // same thing anyway; this just makes it consistent for any future route
  // that forgets the wrapper.)
  res.statusCode = 401;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({message: 'Not authenticated'}));
  return true;
}
