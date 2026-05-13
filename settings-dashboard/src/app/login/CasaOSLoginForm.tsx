'use client';
import {useState, FormEvent} from 'react';

export function CasaOSLoginForm({csrf, returnTo}: {csrf: string; returnTo: string}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // We POST as JSON so the handler can return JSON on failure (avoiding a
  // page navigation that loses the error message). On success, the handler
  // returns {returnTo} and we navigate.
  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const form = new FormData(e.currentTarget);
    const body = {
      username: String(form.get('username') || ''),
      password: String(form.get('password') || ''),
      csrf: String(form.get('csrf') || ''),
      returnTo: String(form.get('returnTo') || '/'),
    };

    try {
      const res = await fetch('/api/auth/casaos/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {'Content-Type': 'application/json', 'Accept': 'application/json'},
        body: JSON.stringify(body),
      });

      if (res.ok) {
        const data = await res.json().catch(() => ({returnTo}));
        window.location.href = data.returnTo || returnTo;
        return;
      }

      const data = await res.json().catch(() => ({message: 'Sign-in failed'}));
      setError(data.message || `Sign-in failed (${res.status})`);
    } catch (err: any) {
      setError(err?.message || 'Network error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <input type="hidden" name="csrf" value={csrf} />
      <input type="hidden" name="returnTo" value={returnTo} />

      <input
        type="text"
        name="username"
        placeholder="Username"
        autoComplete="username"
        required
        disabled={loading}
        style={inputStyle}
      />
      <input
        type="password"
        name="password"
        placeholder="Password"
        autoComplete="current-password"
        required
        disabled={loading}
        style={{...inputStyle, marginTop: 8}}
      />

      {error && <div style={errorStyle}>{error}</div>}

      <button type="submit" disabled={loading} style={{...buttonStyle, marginTop: 12}}>
        {loading ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  background: 'rgba(61, 91, 124, 0.5)',
  border: '1px solid rgba(166, 204, 237, 0.3)',
  borderRadius: 6,
  color: '#ffffff',
  fontSize: 14,
  boxSizing: 'border-box',
};

const buttonStyle: React.CSSProperties = {
  width: '100%',
  padding: '12px 16px',
  background: '#27aae1',
  color: '#ffffff',
  border: 'none',
  borderRadius: 6,
  fontSize: 15,
  fontWeight: 500,
  cursor: 'pointer',
};

const errorStyle: React.CSSProperties = {
  marginTop: 8,
  padding: '8px 10px',
  background: 'rgba(244, 67, 54, 0.15)',
  border: '1px solid rgba(244, 67, 54, 0.4)',
  borderRadius: 6,
  color: '#ff809e',
  fontSize: 13,
};
