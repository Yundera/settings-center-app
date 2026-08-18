// API helper used by panels that don't go through React Admin's data
// provider. The AppShield gate's session cookie is HttpOnly and attached
// automatically on same-origin fetches, so no Authorization header is
// needed. A 401 here means the gate session expired mid-session — hand the
// browser back to the gate's login flow to re-auth.

import {GATE_LOGIN_PATH} from "./gatePaths";

function bounceToLogin(): never {
  if (typeof window !== "undefined") {
    const redirect = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.replace(`${GATE_LOGIN_PATH}?redirect=${redirect}`);
  }
  // Throw so the caller's try/catch doesn't keep going while we navigate.
  throw new Error('Not authenticated');
}

export async function apiRequest<T>(url: string, method: string = "GET", body?: any): Promise<T> {
  const options: RequestInit = {
    method,
    credentials: 'same-origin',
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  };

  let response: Response;
  try {
    response = await fetch(url, options);
  } catch (err: any) {
    throw new Error(err?.message || 'Network error');
  }

  // 401 only. A 403 means the session is valid but lacks the role the route
  // requires (adminMiddleware) — re-authenticating cannot fix that, and
  // bouncing would loop: gate → SSO → back → 403 → gate. Surface it as an
  // error instead and let the panel say why.
  if (response.status === 401) {
    bounceToLogin();
  }

  if (!response.ok) {
    // Routes report failures as {error: "..."}; that text is the useful part
    // (e.g. "refusing to delete the last member of 'admins'"). Fall back to the
    // status line when the body is absent or isn't JSON.
    let detail = '';
    try {
      const body = await response.json();
      detail = body?.error || body?.message || '';
    } catch {
      // Non-JSON body — nothing to add beyond the status.
    }
    throw new Error(detail || `API Error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}
