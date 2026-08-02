import {cookies} from 'next/headers';
import {redirect} from 'next/navigation';
import {jwtVerify} from 'jose';
import {SESSION_KEY} from '@/backend/auth/sessionKey';
import {SESSION_COOKIE} from '@/backend/auth/session';
import {enabledProviders, ProviderEntry} from '@/backend/auth/providers';
import {resolveBrand} from '@/brand/resolveBrand';

// Server-rendered chooser. Reads providers from backend config and renders one
// button per OIDC provider. Every provider is an OIDC redirect — admin sign-in
// funnels through the SSO (Dex) broker, which federates to CasaOS via the
// casaos-oidc-bridge.

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
  // Resolved server-side rather than fetched: this page is already an RSC
  // calling backend code directly, so the brand is baked into the HTML — no
  // client fetch, no logo flash. resolveBrand() never throws.
  const {brand} = resolveBrand();

  return (
    <main style={pageStyle}>
      {/* Reset the user-agent body margin and any inherited overflow so the
          chooser fills the viewport edge-to-edge. Scoped here rather than in
          the root layout because the rest of the app (React Admin) manages
          its own layout reset via MUI's CssBaseline. */}
      <style>{`html, body { margin: 0; padding: 0; height: 100%; overflow: hidden; background: #0a273f; }`}</style>
      <div style={cardStyle}>
        {/* eslint-disable-next-line @next/next/no-img-element -- next/image
            needs a loader and client runtime; this page ships without either.
            The /logo prefix is what serverGate.ts lets through unauthenticated,
            which is why LOGO_PATTERN constrains the filename. */}
        <img src={brand.logo} alt={brand.name} style={logoStyle} />
        <h1 style={titleStyle}>Sign in to {brand.appTitle}</h1>
        <p style={subtitleStyle}>
          Choose how you want to sign in. Your choice will be remembered for next time.
        </p>

        <div style={{display: 'flex', flexDirection: 'column', gap: 12}}>
          {providers.map(p => (
            <ProviderButton key={p.name} provider={p} returnTo={returnTo} highlight={p.name === lastProvider} />
          ))}
        </div>
      </div>
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

// ──────── styles (inline so the chooser ships without MUI hydration) ────────

const logoStyle: React.CSSProperties = {
  display: 'block',
  height: 56,
  margin: '0 auto 20px',
};

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
