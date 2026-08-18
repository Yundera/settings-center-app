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
    // Logout is the gate's, not ours: it holds the session, and it ends on a
    // terminal "Signed out" page rather than bouncing back through the login
    // flow (the IdP's own 30-day session would otherwise sign the user straight
    // back in and make logout look broken). So navigate there and let it finish
    // — do not follow up with a bounce to login.
    if (typeof window !== "undefined") window.location.replace(GATE_LOGOUT_PATH);
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
