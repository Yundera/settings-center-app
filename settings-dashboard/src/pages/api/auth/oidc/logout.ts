import {NextApiRequest, NextApiResponse} from 'next';
import {getOIDCClient} from '@/backend/auth/oidc/registration';
import {getDiscovery} from '@/backend/auth/oidc/discovery';
import {buildRedirectUri} from '@/backend/auth/oidc/redirectUri';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({message: 'Method not allowed'});
  }

  try {
    const redirectUri = buildRedirectUri();
    const client = await getOIDCClient(redirectUri);
    const discovery = await getDiscovery(client.issuer_url);

    if (!discovery.end_session_endpoint) {
      return res.redirect(302, '/');
    }
    res.redirect(302, discovery.end_session_endpoint);
  } catch (err) {
    console.error('OIDC logout error:', err);
    res.redirect(302, '/');
  }
}
