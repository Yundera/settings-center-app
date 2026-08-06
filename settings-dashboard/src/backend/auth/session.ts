import {NextApiRequest, NextApiResponse} from 'next';
import {SignJWT, jwtVerify} from 'jose';
import {SESSION_KEY} from './sessionKey';
import {currentEpoch} from './sessionEpoch';
import {appendSetCookie} from './cookies';

export const SESSION_COOKIE = 'admin_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24; // 1 day

export interface SessionUser {
  id: string;
  fullName: string;
  email: string;
  avatar: string;
  role: string;
  provider: 'sso';
}

function isHttps(req: {headers: Record<string, any>}): boolean {
  const proto = (req.headers['x-forwarded-proto'] as string) || '';
  return proto.split(',')[0].trim() === 'https';
}

function cookieAttrs(req: {headers: Record<string, any>}, maxAge: number): string {
  return [
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
    isHttps(req) ? 'Secure' : '',
  ].filter(Boolean).join('; ');
}

export async function setSession(
  req: NextApiRequest,
  res: NextApiResponse,
  user: SessionUser,
): Promise<void> {
  // Stamp the account's current session generation into the token. readSession
  // rejects any token whose stamp is behind, which is how revoking an account
  // or resetting its password ends sessions that are already in flight — see
  // sessionEpoch.ts.
  const jwt = await new SignJWT({user, epoch: currentEpoch(user.id)})
    .setProtectedHeader({alg: 'HS256'})
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(SESSION_KEY);
  appendSetCookie(res, `${SESSION_COOKIE}=${jwt}; ${cookieAttrs(req, SESSION_TTL_SECONDS)}`);
}

export async function readSession(req: NextApiRequest): Promise<SessionUser | null> {
  return readSessionFromCookieHeader(req.headers.cookie || '');
}

export async function readSessionFromCookieHeader(cookieHeader: string): Promise<SessionUser | null> {
  const match = cookieHeader.split(/;\s*/).find(c => c.startsWith(`${SESSION_COOKIE}=`));
  if (!match) return null;
  const token = match.substring(SESSION_COOKIE.length + 1);
  try {
    const {payload} = await jwtVerify(token, SESSION_KEY);
    const user = (payload as any).user as SessionUser | undefined;
    if (!user?.id || !user?.provider) return null;

    // Reject tokens issued before the account's last revocation. A token minted
    // before this feature shipped has no `epoch` claim and reads as 0, which
    // matches the default — so deploying this does not sign anyone out, but the
    // first bump for an account invalidates everything outstanding for it.
    const tokenEpoch = typeof (payload as any).epoch === 'number' ? (payload as any).epoch : 0;
    if (tokenEpoch !== currentEpoch(user.id)) return null;

    return user;
  } catch {
    return null;
  }
}

export function clearSession(req: NextApiRequest, res: NextApiResponse): void {
  appendSetCookie(res, `${SESSION_COOKIE}=; ${cookieAttrs(req, 0)}`);
}
