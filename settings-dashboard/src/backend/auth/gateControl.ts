import {SignJWT} from 'jose';
import {getConfig} from '@/configuration/getConfigBackend';

/**
 * Client for the AppShield gate's control API.
 *
 * The gate owns the session now, which means it also owns ending one. This app
 * previously stamped a per-account epoch into its own cookie and bumped it to
 * revoke; there is no cookie of ours left to stamp, so revocation became a call
 * to the thing that issued the session.
 *
 * Why it matters: deleting an account or resetting its password stops the NEXT
 * login only. Without revocation, a gate session already in someone's hands
 * stays valid for the rest of its TTL — 30 days by default — and for a revoked
 * administrator on this app that means terminal, SSH keys and reboot keep
 * working. That is the gap this closes.
 */

/** Fixed by AppShield's control-token contract. */
const CONTROL_AUDIENCE = 'appshield-control';
const CONTROL_ISSUER = 'appshield-backend';
/** AppShield refuses tokens whose lifetime exceeds 300s; stay well inside. */
const TOKEN_TTL_SECONDS = 60;
const REQUEST_TIMEOUT_MS = 4000;

function gateBaseUrl(): string {
  // The gate is this app's own sidecar, addressed by container name on `pcs`.
  return (getConfig('APPSHIELD_GATE_URL') || 'http://admin').replace(/\/+$/, '');
}

/**
 * Mint a control token.
 *
 * Signed with IDENTITY_ASSERTION_SECRET — the same secret used to verify the
 * gate's identity assertions, used in the other direction — but on a DIFFERENT
 * audience. That separation is deliberate on AppShield's side and must be
 * respected here: assertions (aud = app name) are handed to us on every request
 * and may end up in a log, so they must not double as revocation credentials.
 */
async function controlToken(): Promise<string | null> {
  const secret = getConfig('IDENTITY_ASSERTION_SECRET');
  if (!secret) return null;
  return new SignJWT({})
    .setProtectedHeader({alg: 'HS256', typ: 'JWT'})
    .setIssuer(CONTROL_ISSUER)
    .setAudience(CONTROL_AUDIENCE)
    .setSubject('admin-app')
    .setIssuedAt()
    .setExpirationTime(`${TOKEN_TTL_SECONDS}s`)
    .sign(new TextEncoder().encode(secret));
}

export interface RevokeSelector {
  /** Every session for this preferred_username. */
  user?: string;
  /** Every session for this IdP subject. */
  sub?: string;
  /** Every session on the gate. */
  all?: boolean;
  /** Session id(s) to spare — used to keep the caller signed in. */
  except?: string | string[];
}

/**
 * Ask the gate to end sessions. Returns how many were revoked, or null if the
 * call could not be made.
 *
 * NEVER THROWS. Callers use this after the state change it follows up on (the
 * account is already deleted, the password already reset), and failing the whole
 * operation because a follow-up call timed out would leave the caller with an
 * error and a completed action. A failure is logged at error level and reported
 * back as null so the handler can mention it.
 */
export async function revokeGateSessions(selector: RevokeSelector): Promise<number | null> {
  const token = await controlToken();
  if (!token) {
    console.error('[gateControl] cannot revoke: IDENTITY_ASSERTION_SECRET is not configured');
    return null;
  }

  const url = `${gateBaseUrl()}/nhl-auth/sessions/revoke`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(selector),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.error(`[gateControl] revoke failed: ${res.status} ${await res.text().catch(() => '')}`);
      return null;
    }
    const body = await res.json();
    const revoked = typeof body?.revoked === 'number' ? body.revoked : 0;
    console.log(`[gateControl] revoked ${revoked} gate session(s) for ${JSON.stringify(selector)}`);
    return revoked;
  } catch (err: any) {
    console.error(`[gateControl] revoke call to ${url} failed: ${err?.message || String(err)}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
