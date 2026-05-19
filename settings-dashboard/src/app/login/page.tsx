import {cookies, headers} from 'next/headers';
import {redirect} from 'next/navigation';
import {jwtVerify} from 'jose';
import {SESSION_KEY} from '@/backend/auth/sessionKey';
import {SESSION_COOKIE} from '@/backend/auth/session';
import {enabledProviders, ProviderEntry} from '@/backend/auth/providers';
import {newCsrfToken, CSRF_COOKIE, csrfCookieAttrs} from '@/backend/auth/csrf';
import {CasaOSLoginForm} from './CasaOSLoginForm';

// Server-rendered chooser. Reads providers from backend config, renders one
// button per OIDC provider and an inline form per password provider. CSRF
// uses the double-submit pattern: the cookie is dropped client-side by a
// tiny inline script (cookies().set is not available in Server Components),
// the matching value is embedded in the form, and the login handler
// constant-time-compares the two.

export const dynamic = 'force-dynamic';

function safeReturnTo(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return '/';
  return raw;
}

async function hasValidSession(): Promise<boolean> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return false;
  try {
    const {payload} = await jwtVerify(token, SESSION_KEY);
    return !!(payload as any).user?.id;
  } catch {
    return false;
  }
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{returnTo?: string}>;
}) {
  const {returnTo: rawReturnTo} = await searchParams;
  const returnTo = safeReturnTo(rawReturnTo);

  if (await hasValidSession()) redirect(returnTo);

  const providers = enabledProviders();
  const lastProvider = (await cookies()).get('last_provider')?.value;
  const csrf = newCsrfToken();
  const isHttps = ((await headers()).get('x-forwarded-proto') || '').split(',')[0].trim() === 'https';

  const oidcProviders = providers.filter(p => p.kind === 'oidc');
  const passwordProviders = providers.filter(p => p.kind === 'password');

  return (
    <main style={pageStyle}>
      {/* Reset the user-agent body margin and any inherited overflow so the
          chooser fills the viewport edge-to-edge. Scoped here rather than in
          the root layout because the rest of the app (React Admin) manages
          its own layout reset via MUI's CssBaseline. */}
      <style>{`html, body { margin: 0; padding: 0; height: 100%; overflow: hidden; background: #0a273f; }`}</style>
      <div style={cardStyle}>
        <h1 style={titleStyle}>Sign in to Settings</h1>
        <p style={subtitleStyle}>
          Choose how you want to sign in. Your choice will be remembered for next time.
        </p>

        <div style={{display: 'flex', flexDirection: 'column', gap: 12}}>
          {oidcProviders.map(p => (
            <ProviderButton key={p.name} provider={p} returnTo={returnTo} highlight={p.name === lastProvider} />
          ))}

          {oidcProviders.length > 0 && passwordProviders.length > 0 && (
            <div style={dividerStyle}>or</div>
          )}

          {passwordProviders.map(p => (
            <div key={p.name}>
              <div style={passwordHeadingStyle}>{p.label}</div>
              <CasaOSLoginForm csrf={csrf} returnTo={returnTo} />
            </div>
          ))}
        </div>
      </div>

      <CsrfCookieSetter token={csrf} secure={isHttps} />
    </main>
  );
}

function ProviderButton({provider, returnTo, highlight}: {provider: ProviderEntry; returnTo: string; highlight: boolean}) {
  return (
    <form action={provider.startUrl} method="get">
      <input type="hidden" name="returnTo" value={returnTo} />
      <button type="submit" style={highlight ? buttonHighlighted : buttonPrimary}>
        {provider.label}
      </button>
    </form>
  );
}

function CsrfCookieSetter({token, secure}: {token: string; secure: boolean}) {
  const attrs = csrfCookieAttrs(secure);
  const cookieValue = `${CSRF_COOKIE}=${token}; ${attrs}`;
  const script = `document.cookie=${JSON.stringify(cookieValue)};`;
  return <script dangerouslySetInnerHTML={{__html: script}} />;
}

// ──────── styles (inline so the chooser ships without MUI hydration) ────────

const pageStyle: React.CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: '#0a273f',
  fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  color: '#ffffff',
  margin: 0,
};

const cardStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: 440,
  background: 'rgba(255, 255, 255, 0.04)',
  border: '1px solid rgba(166, 204, 237, 0.3)',
  borderRadius: 8,
  padding: '32px 30px',
  boxShadow: '0 8px 32px rgba(10, 39, 63, 0.4)',
};

const titleStyle: React.CSSProperties = {
  fontSize: 22,
  fontWeight: 700,
  margin: '0 0 8px 0',
  textAlign: 'center',
};

const subtitleStyle: React.CSSProperties = {
  textAlign: 'center',
  color: '#a6cced',
  fontSize: 13,
  lineHeight: 1.5,
  margin: '0 0 24px 0',
};

const buttonPrimary: React.CSSProperties = {
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

const buttonHighlighted: React.CSSProperties = {
  ...buttonPrimary,
  background: 'linear-gradient(90deg, #27aae1, #ee2a7b)',
};

const dividerStyle: React.CSSProperties = {
  textAlign: 'center',
  color: '#769ab5',
  fontSize: 12,
  textTransform: 'uppercase',
  letterSpacing: 1,
  margin: '8px 0',
};

const passwordHeadingStyle: React.CSSProperties = {
  fontSize: 13,
  color: '#a6cced',
  marginBottom: 8,
};
