import {getConfig} from '@/configuration/getConfigBackend';

// The settings-center-app container is named `admin` in the PCS compose
// template, which makes its public URL `https://admin-${DOMAIN}` and pins
// mesh-router-auth's derived client_id to `admin`. The redirect URI is
// therefore deterministic and does not depend on browser-controlled
// X-Forwarded-* headers — both this app and Authelia live on the same
// ${DOMAIN}, so if DOMAIN doesn't resolve, OIDC can't work anyway.
const SUBDOMAIN = 'admin';

export function buildRedirectUri(): string {
  const domain = getConfig('DOMAIN');
  if (!domain) throw new Error('DOMAIN not configured; cannot build OIDC redirect URI');
  return `https://${SUBDOMAIN}-${domain}/api/auth/oidc/callback`;
}
