import {getConfig} from '@/configuration/getConfigBackend';

// The settings-center-app container is named `admin` in the PCS compose
// template, which makes its public URL `https://admin-${DOMAIN}` and pins
// mesh-router-auth's derived client_id to `admin`. The redirect URI is
// therefore deterministic and does not depend on browser-controlled
// X-Forwarded-* headers — both this app and Authelia live on the same
// ${DOMAIN}, so if DOMAIN doesn't resolve, OIDC can't work anyway.
const SUBDOMAIN = 'admin';

// Authelia ('default') is registered at the un-namespaced /callback path
// since that's the URL the existing auth-registrar wrote to clients.d/admin.yml
// and re-registration is a no-op. Additional providers (Yundera, etc.) get
// their own subfolder and use the same builder with their name.
export function buildRedirectUri(provider: 'default' | string = 'default'): string {
  const domain = getConfig('DOMAIN');
  if (!domain) throw new Error('DOMAIN not configured; cannot build OIDC redirect URI');
  const path = provider === 'default'
    ? '/api/auth/oidc/callback'
    : `/api/auth/oidc/${provider}/callback`;
  return `https://${SUBDOMAIN}-${domain}${path}`;
}
