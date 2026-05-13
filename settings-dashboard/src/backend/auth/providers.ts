import {getConfig} from '@/configuration/getConfigBackend';

export type ProviderName = 'casaos' | 'authelia' | 'yundera';

export interface ProviderEntry {
  name: ProviderName;
  label: string;
  kind: 'password' | 'oidc';
  // For OIDC providers, the URL the chooser button hits to start the redirect.
  startUrl?: string;
}

// A provider is "enabled" if its config knob is present. Order here is the
// order the chooser renders buttons in — OIDC first, password last.
export function enabledProviders(): ProviderEntry[] {
  const list: ProviderEntry[] = [];

  if (getConfig('YUNDERA_OIDC_ISSUER')) {
    list.push({
      name: 'yundera',
      label: 'Sign in with Yundera',
      kind: 'oidc',
      startUrl: '/api/auth/oidc/yundera/start',
    });
  }

  if (getConfig('OIDC_REGISTRAR_URL')) {
    list.push({
      name: 'authelia',
      label: 'Sign in with Authelia',
      kind: 'oidc',
      startUrl: '/api/auth/oidc/start',
    });
  }

  // CasaOS is always-on: the AUTHORITY_ENDPOINT env is informational; if it's
  // missing we still fall back to the internal hostname `casaos:8080` which
  // is guaranteed to exist on every PCS by the compose template.
  list.push({
    name: 'casaos',
    label: 'Sign in with CasaOS',
    kind: 'password',
  });

  return list;
}
