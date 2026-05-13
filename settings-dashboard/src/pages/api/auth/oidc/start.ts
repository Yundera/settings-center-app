import {NextApiRequest, NextApiResponse} from 'next';
import {getOIDCClient} from '@/backend/auth/oidc/registration';
import {getDiscovery} from '@/backend/auth/oidc/discovery';
import {generatePKCE, generateState, setStateCookie} from '@/backend/auth/oidc/state';
import {buildRedirectUri} from '@/backend/auth/oidc/redirectUri';

function safeReturnTo(req: NextApiRequest): string {
  const raw = (req.query.returnTo as string) || '/';
  // Only relative paths to prevent open-redirect.
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/';
  return raw;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({message: 'Method not allowed'});
  }

  try {
    const redirectUri = buildRedirectUri();
    const client = await getOIDCClient(redirectUri);
    const discovery = await getDiscovery(client.issuer_url);

    const state = generateState();
    const {verifier, challenge} = generatePKCE();
    const returnTo = safeReturnTo(req);

    await setStateCookie(res, req, {state, codeVerifier: verifier, returnTo, redirectUri});

    const url = new URL(discovery.authorization_endpoint);
    url.searchParams.set('client_id', client.client_id);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('scope', 'openid profile email groups');
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');

    res.redirect(302, url.toString());
  } catch (err) {
    console.error('Authelia OIDC start error:', err);
    res.status(500).json({message: 'OIDC login failed'});
  }
}
