import {getConfig} from '@/configuration/getConfigBackend';

export type ProviderName = 'sso' | 'yundera';

export interface ProviderEntry {
  name: ProviderName;
  label: string;
  // The URL the chooser button hits to start the OIDC redirect.
  startUrl: string;
}

// A provider is "enabled" if its config knob is present. Every provider is an
// OIDC redirect — under the Dex broker model the SSO provider funnels all
// admin sign-ins (Dex in turn federates to CasaOS via the casaos-oidc-bridge).
export function enabledProviders(): ProviderEntry[] {
  const list: ProviderEntry[] = [];

  if (getConfig('YUNDERA_OIDC_ISSUER')) {
    list.push({
      name: 'yundera',
      label: 'Sign in with Yundera',
      startUrl: '/api/auth/oidc/yundera/start',
    });
  }

  // The registrar-driven SSO provider. The OIDC provider it targets is whatever
  // the auth-registrar points at (Dex via REGISTRAR_BACKEND=dex) — hence the
  // backend-neutral "Single Sign-On" label.
  if (getConfig('OIDC_REGISTRAR_URL')) {
    list.push({
      name: 'sso',
      label: 'Single Sign-On',
      startUrl: '/api/auth/oidc/start',
    });
  }

  return list;
}
