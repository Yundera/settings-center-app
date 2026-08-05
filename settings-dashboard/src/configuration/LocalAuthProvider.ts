import {AuthProvider} from "ra-core";

// The server-side gate in server.ts redirects unauthenticated page loads to
// /login before the SPA ever mounts, so checkAuth here is just a sanity
// probe — any 401 from /api/me means the cookie expired between page load
// and a downstream call.

function bounceToLogin(): Promise<never> {
  if (typeof window === "undefined") return Promise.reject(new Error("Not authenticated"));
  const returnTo = encodeURIComponent(window.location.pathname + window.location.search);
  window.location.replace(`/login?returnTo=${returnTo}`);
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
  // `role` comes from the OIDC `groups` claim via deriveRole() in
  // pages/api/auth/oidc/callback.ts — members of `admins` in Authelia's
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
    try {
      await fetch('/api/auth/logout', {method: 'POST', credentials: 'same-origin'});
    } catch {
      // Even if the logout call fails, force the user back to the chooser —
      // any stale cookie will be replaced on next sign-in.
    }
    return bounceToLogin();
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
