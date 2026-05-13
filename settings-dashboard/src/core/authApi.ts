// API helper used by panels that don't go through React Admin's data
// provider. The session cookie is set HttpOnly by the server and attached
// automatically on same-origin fetches, so no Authorization header is
// needed. A 401 here means the session expired mid-session — bounce to the
// chooser to re-auth.

function bounceToLogin(): never {
  if (typeof window !== "undefined") {
    const returnTo = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.replace(`/login?returnTo=${returnTo}`);
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

  if (response.status === 401 || response.status === 403) {
    bounceToLogin();
  }

  if (!response.ok) {
    throw new Error(`API Error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}
