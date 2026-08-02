import {getConfig} from '@/configuration/getConfigBackend';

export type ProviderName = 'sso';

export interface ProviderEntry {
  name: ProviderName;
  label: string;
  // The URL the chooser button hits to start the OIDC redirect.
  startUrl: string;
}

// A provider is "enabled" if its config knob is present. Every provider is an
// OIDC redirect — under the Dex broker model the SSO provider funnels all admin
// sign-ins, and Dex fans out to its own connectors (Authelia for the local
// account; the orchestrator's IdP for "Yundera Login", registered by
// template-root's ensure-dex.sh). That is why there is only one entry here:
// choosing between identities is Dex's screen, not ours.
//
// There used to be a second entry gated on YUNDERA_OIDC_ISSUER, pointing at
// /api/auth/oidc/yundera/start — a route that was never implemented, so setting
// the knob produced a button that 404'd. The feature it was reaching for now
// ships as the Dex connector described above.
export function enabledProviders(): ProviderEntry[] {
  const list: ProviderEntry[] = [];

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
