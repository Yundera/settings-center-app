import {NextApiRequest, NextApiResponse} from 'next';
import axios from 'axios';
import {getOIDCClient} from '@/backend/auth/oidc/registration';
import {getDiscovery, verifyIdToken} from '@/backend/auth/oidc/discovery';
import {consumeStateCookie} from '@/backend/auth/oidc/state';
import {setSession} from '@/backend/auth/session';
import {appendSetCookie} from '@/backend/auth/cookies';

interface TokenResponse {
  id_token: string;
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in: number;
}

function deriveRole(groups: unknown): string {
  if (Array.isArray(groups)) {
    if (groups.includes('admin') || groups.includes('admins')) return 'admin';
    if (groups.length > 0) return String(groups[0]);
  }
  return 'user';
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => (
    {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c] as string
  ));
}

function htmlError(res: NextApiResponse, message: string, status = 400) {
  res.status(status).setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(
    `<!DOCTYPE html><html><head><title>Sign-in failed</title></head><body>` +
    `<h1>Sign-in failed</h1><pre>${escapeHtml(message)}</pre>` +
    `<p><a href="/login">Back to sign-in</a></p></body></html>`
  );
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({message: 'Method not allowed'});
  }

  const stateClaim = await consumeStateCookie(req, res);
  if (!stateClaim) {
    return htmlError(res, 'Missing or expired auth state. Please retry sign-in.');
  }

  const {code, state, error, error_description} = req.query as Record<string, string>;
  if (error) {
    return htmlError(res, `Provider returned error: ${error}${error_description ? ' - ' + error_description : ''}`);
  }
  if (!code || !state) {
    return htmlError(res, 'Missing code or state in callback.');
  }
  if (state !== stateClaim.state) {
    return htmlError(res, 'State mismatch.');
  }

  try {
    const client = await getOIDCClient(stateClaim.redirectUri);
    const discovery = await getDiscovery(client.issuer_url);

    // Authelia clients are configured with token_endpoint_auth_method=client_secret_basic.
    const basicAuth = Buffer
      .from(`${encodeURIComponent(client.client_id)}:${encodeURIComponent(client.client_secret)}`)
      .toString('base64');

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: stateClaim.redirectUri,
      code_verifier: stateClaim.codeVerifier,
    });

    const tokenResp = await axios.post<TokenResponse>(
      discovery.token_endpoint,
      body.toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${basicAuth}`,
          'Accept': 'application/json',
        },
        timeout: 10000,
      },
    );

    if (!tokenResp.data?.id_token) {
      return htmlError(res, 'Token endpoint did not return id_token.', 502);
    }

    const claims = await verifyIdToken(tokenResp.data.id_token, discovery, client.client_id);

    const sub = String(claims.sub || '');
    if (!sub) return htmlError(res, 'ID token missing sub claim.', 502);

    const preferredUsername = (claims as any).preferred_username as string | undefined;
    const email = (claims as any).email as string | undefined;
    const name = (claims as any).name as string | undefined;
    const groups = (claims as any).groups as unknown;

    const userId = preferredUsername || sub;
    await setSession(req, res, {
      id: userId,
      fullName: name || preferredUsername || sub,
      email: email || '',
      avatar: '',
      role: deriveRole(groups),
      provider: 'authelia',
    });
    appendSetCookie(res, `last_provider=authelia; Path=/; Max-Age=${60 * 60 * 24 * 90}; SameSite=Lax`);

    const returnTo = stateClaim.returnTo || '/';
    res.redirect(302, returnTo);
  } catch (err: any) {
    const detail = err?.response?.data || err?.message || String(err);
    console.error('Authelia OIDC callback error:', detail);
    return htmlError(res, typeof detail === 'string' ? detail : JSON.stringify(detail), 500);
  }
}
