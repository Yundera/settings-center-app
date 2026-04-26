import axios from 'axios';
import {createRemoteJWKSet, JWTPayload, jwtVerify} from 'jose';
import {OIDCDiscovery} from './types';

const discoveryCache = new Map<string, Promise<OIDCDiscovery>>();
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export async function getDiscovery(issuerUrl: string): Promise<OIDCDiscovery> {
  const cached = discoveryCache.get(issuerUrl);
  if (cached) return cached;

  const promise = (async () => {
    const url = `${issuerUrl.replace(/\/+$/, '')}/.well-known/openid-configuration`;
    const response = await axios.get<OIDCDiscovery>(url, {timeout: 10000});
    const d = response.data;
    if (!d?.issuer || !d?.authorization_endpoint || !d?.token_endpoint || !d?.jwks_uri) {
      throw new Error('Invalid OIDC discovery document');
    }
    return d;
  })();

  discoveryCache.set(issuerUrl, promise);
  promise.catch(() => discoveryCache.delete(issuerUrl));
  return promise;
}

function getJWKS(jwksUri: string) {
  let jwks = jwksCache.get(jwksUri);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(jwksUri));
    jwksCache.set(jwksUri, jwks);
  }
  return jwks;
}

export async function verifyIdToken(
  idToken: string,
  discovery: OIDCDiscovery,
  audience: string,
): Promise<JWTPayload> {
  const jwks = getJWKS(discovery.jwks_uri);
  const {payload} = await jwtVerify(idToken, jwks, {
    issuer: discovery.issuer,
    audience,
  });
  return payload;
}
