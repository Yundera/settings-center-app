import {AuthProvider} from "ra-core";
import {GATE_LOGIN_PATH, GATE_LOGOUT_PATH} from "@/core/gatePaths";

// Login lives in the AppShield gate in front of this app, not here. An
// unauthenticated page load never reaches the SPA — the gate redirects it, and
// serverGate.ts in server.ts refuses it as a second line — so checkAuth here is
// just a sanity probe: any 401 from /api/me means the gate session ended between
// page load and a downstream call.

function bounceToLogin(): Promise<never> {
  if (typeof window === "undefined") return Promise.reject(new Error("Not authenticated"));
  const redirect = encodeURIComponent(window.location.pathname + window.location.search);
  window.location.replace(`${GATE_LOGIN_PATH}?redirect=${redirect}`);
  return new Promise<never>(() => {}); // navigation in progress
}

interface MeUser {
  id: string;
  fullName: string;
  email: string;
  avatar: string;
  role: string;
  provider: string;
}

async function fetchMe(): Promise<MeUser | null> {
  try {
    const res = await fetch('/api/me', {credentials: 'same-origin'});
    if (!res.ok) return null;
    const data = await res.json();
    return data?.user || null;
  } catch {
    return null;
  }
}

/**
 * The upstream IdP's logout endpoint, or null when the deployment configures
 * none. Read at logout time rather than cached at load: a session can outlive a
 * config change, and this is not hot enough for the round trip to matter.
 */
async function fetchUpstreamLogoutUrl(): Promise<string | null> {
  try {
    const res = await fetch('/api/me', {credentials: 'same-origin'});
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data?.upstreamLogoutUrl === 'string' ? data.upstreamLogoutUrl : null;
  } catch {
    return null;
  }
}

export const localAuthProvider: AuthProvider = {
  // Drives the panel filter in App.tsx (`permissions[panel.permissions]`).
  // `role` comes from the groups claim in the gate's identity assertion via
  // deriveRole() in backend/auth/session.ts — members of `admins` in Authelia's
  // users_database.yml get 'admin', everyone else 'user'.
  //
  // This is presentation only. The enforcing gate is adminMiddleware on every
  // /api/admin route; hiding a panel here just avoids showing a non-admin
  // controls that would 403 on use.
  async listPermissions() {
    const me = await fetchMe();
    return {admin: me?.role === 'admin'};
  },
  async login() {
    return bounceToLogin();
  },
  async checkError(error) {
    const status = error?.status;
    // 401 only — a 403 is an authorization failure (adminMiddleware), not an
    // expired session, so bouncing to the chooser would loop instead of
    // resolving it. See the matching note in core/authApi.ts.
    if (status === 401) {
      return bounceToLogin();
    }
  },
  async checkAuth() {
    const me = await fetchMe();
    if (!me) return bounceToLogin();
  },
  async logout() {
    // Two sessions end here, and the browser has to end one of them itself.
    //
    // The gate owns this app's session and ends it at GATE_LOGOUT_PATH, on a
    // terminal "Signed out" page rather than a bounce back through the login
    // flow (the IdP's own 30-day session would otherwise sign the user straight
    // back in and make logout look broken).
    //
    // But that IdP session is exactly what makes the connector chooser theatre:
    // while it stands, picking a connector is a silent redirect and nobody is
    // asked for a credential. Ending it cannot be done server-side — the cookie
    // is the browser's, host-only on a sibling host — so the POST goes out from
    // here. `no-cors` keeps it a simple request: no preflight, nothing required
    // of the IdP's CORS config, and an opaque response we never read. The cookie
    // rides because both hosts are `<app>-${DOMAIN}` and the request is
    // therefore same-site, which SameSite=lax permits.
    //
    // Best-effort by construction, as logout is in the specs that define it: the
    // await orders this before the navigation, and every outcome — no configured
    // upstream, network failure, opaque rejection — still falls through to the
    // gate logout below. Failing to reach the IdP must never trap the user
    // inside this app.
    if (typeof window === "undefined") return;
    const upstream = await fetchUpstreamLogoutUrl();
    if (upstream) {
      try {
        await fetch(upstream, {method: 'POST', mode: 'no-cors', credentials: 'include'});
      } catch {
        // Opaque by design — a thrown error here says the request never left,
        // not that the IdP refused. Either way the gate session still has to go.
      }
    }
    window.location.replace(GATE_LOGOUT_PATH);
    return new Promise<never>(() => {});
  },
  async getIdentity() {
    const me = await fetchMe();
    if (!me) throw new Error('not authenticated');
    return {
      id: me.id,
      fullName: me.fullName,
      avatar: me.avatar,
      email: me.email,
      role: me.role,
      authToken: '', // legacy field; no longer used (cookies do the work).
    };
  },
};
