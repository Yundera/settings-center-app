import axios from 'axios';
import {getConfig} from '@/configuration/getConfigBackend';
import {OIDCClient} from './types';

// Lazy, memoized client registration with mesh-router-auth.
// The script behind /register is idempotent: re-registering the same caller
// (identified by container PTR on the pcs network) returns the same secret.
// We cache by redirect URI so different deployments don't collide.
const cache = new Map<string, Promise<OIDCClient>>();

function registrarUrl(): string {
  const url = getConfig('OIDC_REGISTRAR_URL');
  if (!url) throw new Error('OIDC_REGISTRAR_URL not configured');
  return url;
}

export async function getOIDCClient(redirectUri: string): Promise<OIDCClient> {
  const cached = cache.get(redirectUri);
  if (cached) return cached;

  const promise = (async () => {
    const response = await axios.post<OIDCClient>(
      registrarUrl(),
      {redirect_uris: [redirectUri]},
      {headers: {'Content-Type': 'application/json'}, timeout: 10000},
    );
    const data = response.data;
    if (!data?.client_id || !data?.client_secret || !data?.issuer_url) {
      throw new Error('Invalid registrar response: missing required fields');
    }
    return data;
  })();

  cache.set(redirectUri, promise);
  promise.catch(() => cache.delete(redirectUri));
  return promise;
}
