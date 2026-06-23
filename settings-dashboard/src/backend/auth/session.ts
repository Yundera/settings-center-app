import {NextApiRequest, NextApiResponse} from 'next';
import {SignJWT, jwtVerify} from 'jose';
import {SESSION_KEY} from './sessionKey';
import {appendSetCookie} from './cookies';

export const SESSION_COOKIE = 'admin_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24; // 1 day

export interface SessionUser {
  id: string;
  fullName: string;
  email: string;
  avatar: string;
  role: string;
  provider: 'sso' | 'yundera';
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
  const jwt = await new SignJWT({user})
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
    return user;
  } catch {
    return null;
  }
}

export function clearSession(req: NextApiRequest, res: NextApiResponse): void {
  appendSetCookie(res, `${SESSION_COOKIE}=; ${cookieAttrs(req, 0)}`);
}
