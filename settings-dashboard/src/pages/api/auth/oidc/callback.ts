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

/**
 * Groups in the Dex ID token that confer administrator rights on this PCS.
 *
 * Deliberately vendor-neutral: this app ships in the FOSS mesh template as well
 * as the managed one, so it must not know the name of any particular identity
 * provider. Any IdP wired into this PCS's Dex asserts administrator status the
 * same way — by putting the user in `admins`.
 *
 * Two producers today:
 *   - Authelia, the local credential store (ensure-authelia.sh seeds the
 *     operator account into `admins`; the Account panel assigns it).
 *   - An operator IdP, where one exists. On managed boxes that is Yundera
 *     Login, whose IdP enforces a central, fail-closed owner policy — only the
 *     uid bound as owner_uid at client registration can complete an authorize
 *     against this PCS's client — so it asserts `admins` for the verified owner.
 *
 * Keyed on the group rather than the connector because Dex does not emit
 * `federated_claims` in its ID token (verified against dex v2.43.1 — the claim
 * set is iss/sub/aud/exp/iat/at_hash/c_hash/email/email_verified/groups/name/
 * preferred_username). The connector id is recoverable only by decoding Dex's
 * protobuf-encoded `sub`, which would couple us to Dex internals.
 */
const ADMIN_GROUPS = ['admin', 'admins'];

/**
 * Collapse the OIDC `groups` claim to this dashboard's binary role.
 *
 * Deliberately binary. The previous implementation fell through to
 * `String(groups[0])`, so a plain user in group `users` got `role: "users"` —
 * harmless while every check was `=== 'admin'`, but a raw group name leaking
 * into an authorization field is a hazard now that adminMiddleware gates every
 * /api/admin route on it.
 */
function deriveRole(groups: unknown): string {
  if (Array.isArray(groups) && groups.some(g => ADMIN_GROUPS.includes(String(g)))) {
    return 'admin';
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

    // Registrar-issued clients use token_endpoint_auth_method=client_secret_basic
    // (true for both Authelia and Dex, which the auth-registrar provisions).
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
      provider: 'sso',
    });
    appendSetCookie(res, `last_provider=sso; Path=/; Max-Age=${60 * 60 * 24 * 90}; SameSite=Lax`);

    const returnTo = stateClaim.returnTo || '/';
    res.redirect(302, returnTo);
  } catch (err: any) {
    const detail = err?.response?.data || err?.message || String(err);
    console.error('SSO OIDC callback error:', detail);
    return htmlError(res, typeof detail === 'string' ? detail : JSON.stringify(detail), 500);
  }
}
