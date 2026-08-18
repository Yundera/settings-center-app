import {IncomingHttpHeaders} from 'http';
import {jwtVerify} from 'jose';
import {getConfig} from '@/configuration/getConfigBackend';

/**
 * Who the AppShield gate says this request is.
 *
 * This app used to be its own OIDC client: it ran the authorization_code flow,
 * minted an `admin_session` JWT and read that cookie back on every request.
 * All of it is gone. The gate in front (container `admin`, this app is
 * `admin-app`) does the OIDC dance once for the whole PCS and states the result
 * per request; our job shrank to verifying that statement.
 *
 * WHY THE ASSERTION AND NOT THE PLAIN HEADERS. The gate also forwards
 * Remote-User / Remote-Groups etc., and for an ordinary app that is enough,
 * because nothing but the gate can route to it. It is NOT enough here: this app
 * sits on the shared `pcs` network with `expose: 80`, so any other container —
 * including any installed app that gets compromised — can open a socket
 * straight to us and send whatever headers it likes. `X-AppShield-Assertion` is
 * a short-lived HS256 JWT over the same claims, signed with a secret only the
 * gate and this app hold, which makes such a request detectable instead of
 * indistinguishable. Given what this app can do (host shell, SSH keys, reboot),
 * that difference is the whole ballgame — so the plain headers are deliberately
 * ignored, and no session exists without a verifiable assertion.
 */
export interface GateIdentity {
  /** How the caller authenticated: oidc | password | hash | oauth. */
  method: string;
  /** IdP subject. Empty for `password`, which has no issuer. */
  sub: string;
  /** preferred_username — the name Authelia/Dex know the account by. */
  user: string;
  email: string;
  name: string;
  groups: string[];
}

export const ASSERTION_HEADER = 'x-appshield-assertion';

/** Issuer the gate stamps. Fixed string in AppShield's mintAssertion(). */
const ASSERTION_ISSUER = 'appshield';

/**
 * Expected `aud`. AppShield sets it to its own APP_NAME, which for our gate is
 * `admin` (the container name — the compose sets APP_NAME explicitly rather
 * than leaning on the hostname default, so this pairing is visible on both
 * sides). Overridable for the dev harness, where the gate may be named
 * differently.
 */
function expectedAudience(): string {
  return getConfig('IDENTITY_ASSERTION_AUDIENCE') || 'admin';
}

function secretKey(): Uint8Array | null {
  const secret = getConfig('IDENTITY_ASSERTION_SECRET');
  if (!secret) return null;
  return new TextEncoder().encode(secret);
}

/**
 * Dev-only identity, for running the app without a gate in front of it
 * (`next dev` on a laptop). Format: `username` or `username:group,group`.
 *
 * Refused when NODE_ENV is production — a PCS image must never be able to
 * conjure an admin out of an environment variable, whatever is in its compose.
 */
function devIdentity(): GateIdentity | null {
  const raw = getConfig('DEV_IDENTITY');
  if (!raw) return null;
  if (process.env.NODE_ENV === 'production') {
    console.error('[gateIdentity] DEV_IDENTITY is set but ignored: NODE_ENV=production');
    return null;
  }
  const [user, groupList] = String(raw).split(':');
  const groups = (groupList || 'admins').split(',').map(g => g.trim()).filter(Boolean);
  console.warn(`[gateIdentity] DEV_IDENTITY active — request treated as ${user} in [${groups.join(',')}]`);
  return {method: 'dev', sub: `dev:${user}`, user, email: '', name: user, groups};
}

let warnedMissingSecret = false;

/**
 * Verify the gate's assertion and return the identity it carries, or null.
 *
 * Returning null is always "not authenticated" — never "authenticated with
 * nothing". Every caller treats it as a hard stop.
 */
export async function readGateIdentity(headers: IncomingHttpHeaders): Promise<GateIdentity | null> {
  const dev = devIdentity();
  if (dev) return dev;

  const key = secretKey();
  if (!key) {
    // Misconfiguration, not an attack: say so once, loudly, then fail closed.
    // Nothing works until the gate and this app share a secret.
    if (!warnedMissingSecret) {
      warnedMissingSecret = true;
      console.error(
        '[gateIdentity] IDENTITY_ASSERTION_SECRET is not set — every request will be ' +
        'unauthenticated. The AppShield gate in front of this app must set the same secret.'
      );
    }
    return null;
  }

  const raw = headers[ASSERTION_HEADER];
  const token = Array.isArray(raw) ? raw[0] : raw;
  if (!token) return null;

  try {
    const {payload, protectedHeader} = await jwtVerify(token, key, {
      issuer: ASSERTION_ISSUER,
      audience: expectedAudience(),
    });
    // The key is symmetric so only HMAC could have verified; asserted anyway so
    // a future change to how the key is built cannot silently widen this.
    if (protectedHeader.alg !== 'HS256') return null;

    const groups = Array.isArray((payload as any).groups)
      ? (payload as any).groups.map(String)
      : [];
    const user = String((payload as any).user || payload.sub || '');
    if (!user) return null;

    return {
      method: String((payload as any).method || 'oidc'),
      sub: String(payload.sub || ''),
      user,
      email: String((payload as any).email || ''),
      name: String((payload as any).name || ''),
      groups,
    };
  } catch (err: any) {
    // Includes the ordinary case of an expired assertion (they live ~60s), which
    // only happens if a request was in flight long enough to outlive one, and
    // the gate mints a fresh one per request.
    console.warn(`[gateIdentity] assertion rejected: ${err?.message || String(err)}`);
    return null;
  }
}

/**
 * The gate's own session cookie, as forwarded to us. Not a credential we
 * validate — the assertion is that — but the handle needed to ask the gate to
 * revoke *other* sessions while sparing this one (see gateControl.ts).
 */
export const GATE_SESSION_COOKIE = 'appshield_session';

export function gateSessionId(headers: IncomingHttpHeaders): string | null {
  const header = headers.cookie || '';
  const match = header.split(/;\s*/).find(c => c.startsWith(`${GATE_SESSION_COOKIE}=`));
  return match ? match.substring(GATE_SESSION_COOKIE.length + 1) : null;
}
