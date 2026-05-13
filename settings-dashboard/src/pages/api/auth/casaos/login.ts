import {NextApiRequest, NextApiResponse} from 'next';
import axios from 'axios';
import {getConfig} from '@/configuration/getConfigBackend';
import {setSession} from '@/backend/auth/session';
import {appendSetCookie} from '@/backend/auth/cookies';
import {validateCsrf} from '@/backend/auth/csrf';

// CasaOS UserService default. The compose template sets AUTHORITY_ENDPOINT to
// the public hostname (https://8080-casaos-${DOMAIN}/v1/users); when unset, we
// fall back to the in-cluster service name which skips the TLS / public-route
// dance entirely.
const DEFAULT_AUTHORITY = 'http://casaos:8080/v1/users';

function getAuthority(): string {
  return getConfig('AUTHORITY_ENDPOINT') || DEFAULT_AUTHORITY;
}

interface CasaOSAuthResponse {
  success: number;
  message: string;
  data: {
    token: {
      refresh_token: string;
      access_token: string;
      expires_at: number;
    };
    user: {
      id: number;
      username: string;
      role: string;
      email: string;
      nickname: string;
      avatar: string;
      description: string;
      created_at: string;
      updated_at: string;
    };
  };
}

function safeReturnTo(raw: unknown): string {
  if (typeof raw !== 'string') return '/';
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/';
  return raw;
}

function wantsJson(req: NextApiRequest): boolean {
  const accept = String(req.headers.accept || '');
  return accept.includes('application/json');
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({message: 'Method not allowed'});
  }

  // Form-encoded POSTs from the chooser arrive as req.body parsed by Next.js
  // (it handles application/x-www-form-urlencoded and application/json).
  const body = (req.body || {}) as Record<string, string>;
  const username = body.username;
  const password = body.password;
  const csrfToken = body.csrf;
  const returnTo = safeReturnTo(body.returnTo);

  if (!validateCsrf(req, csrfToken)) {
    return res.status(403).json({message: 'CSRF check failed'});
  }
  if (!username || !password) {
    return res.status(400).json({message: 'Username and password are required'});
  }

  try {
    const authorityEndpoint = `${getAuthority()}/login`;
    const casaResp = await axios.post<CasaOSAuthResponse>(
      authorityEndpoint,
      {username, password},
      {timeout: 10000},
    );

    if (casaResp.data.success !== 200 || casaResp.data.message !== 'ok') {
      return res.status(401).json({message: 'Authentication failed'});
    }

    const {user, token} = casaResp.data.data;

    await setSession(req, res, {
      id: username,
      fullName: user.nickname || username,
      email: user.email || '',
      // Avatar is still served by CasaOS with the access token in the query
      // string. Tracked as follow-up — leaking the token to the browser isn't
      // ideal but is unchanged from the previous behavior.
      avatar: `${getAuthority()}/avatar?token=${token.access_token}`,
      role: user.role,
      provider: 'casaos',
    });

    // Remember the user's last provider choice for the chooser to pre-highlight.
    appendSetCookie(res, `last_provider=casaos; Path=/; Max-Age=${60 * 60 * 24 * 90}; SameSite=Lax`);

    if (wantsJson(req)) {
      return res.status(200).json({returnTo});
    }
    return res.redirect(302, returnTo);
  } catch (err) {
    if (axios.isAxiosError(err)) {
      const status = err.response?.status || 500;
      const message = err.response?.data?.message || 'Authentication failed';
      return res.status(status === 401 ? 401 : 500).json({message});
    }
    console.error('CasaOS login error:', err);
    return res.status(500).json({message: 'Internal server error'});
  }
}
