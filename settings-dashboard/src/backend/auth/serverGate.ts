import {IncomingMessage, ServerResponse} from 'http';
import {jwtVerify} from 'jose';
import {SESSION_KEY} from './sessionKey';
import {SESSION_COOKIE} from './session';

// Paths that bypass the page-level gate. API routes that need auth use
// authMiddleware themselves; everything in this list is intentionally
// reachable without a session cookie (login flow, static assets, health).
const BYPASS_PREFIXES = [
  '/api/auth/',          // login, logout, providers, oidc/*
  '/api/me',             // does its own session check
  '/api/health',         // public probe
  '/api/perf',           // public RAM-cached metrics snapshot (orchestrator `pcs perf`)
  '/api/bench/',         // public disk/network bench cache (orchestrator `pcs perf`);
                         //   read-only snapshot + cooldown-gated lazy trigger,
                         //   so an unauthenticated caller can start at most one
                         //   bench per cooldown window (see BenchCache.ts)
  '/api/local/',         // loopback-only routes (orchestrator's Path C trigger,
                         //   source's migration-status poll) — gated by
                         //   `loopbackOnly` middleware on the handler itself;
                         //   must skip the session gate so unauthenticated
                         //   loopback callers can reach `loopbackOnly`.
  '/_next/',             // Next.js runtime
  '/login',              // chooser
  '/favicon',
  '/logo',
  '/robots.txt',
  '/manifest',
];

function shouldBypass(pathname: string): boolean {
  if (pathname === '/login') return true;
  return BYPASS_PREFIXES.some(p => pathname.startsWith(p));
}

function readSessionCookieRaw(req: IncomingMessage): string | null {
  const header = req.headers.cookie || '';
  const match = header.split(/;\s*/).find(c => c.startsWith(`${SESSION_COOKIE}=`));
  return match ? match.substring(SESSION_COOKIE.length + 1) : null;
}

async function hasValidSession(req: IncomingMessage): Promise<boolean> {
  const token = readSessionCookieRaw(req);
  if (!token) return false;
  try {
    const {payload} = await jwtVerify(token, SESSION_KEY);
    return !!(payload as any).user?.id;
  } catch {
    return false;
  }
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

  if (await hasValidSession(req)) return false;

  // Page request (no /api/ prefix): bounce to chooser preserving target.
  if (!pathname.startsWith('/api/')) {
    const search = req.url && req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
    const returnTo = encodeURIComponent(pathname + search);
    res.statusCode = 302;
    res.setHeader('Location', `/login?returnTo=${returnTo}`);
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
