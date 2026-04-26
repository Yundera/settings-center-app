import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import {NextApiRequest, NextApiResponse} from 'next';
import {getConfig} from '@/configuration/getConfigBackend';
import {OIDCStateClaim} from './types';

const STATE_COOKIE = 'oidc_state';
const STATE_TTL_SECONDS = 300;

function secret(): string {
  const s = getConfig('JWT_SECRET');
  if (!s) throw new Error('JWT_SECRET required for OIDC state signing');
  return s;
}

function base64url(buf: Buffer): string {
  return buf.toString('base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

export function generateState(): string {
  return base64url(crypto.randomBytes(16));
}

export function generatePKCE(): {verifier: string; challenge: string} {
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
  return {verifier, challenge};
}

function isHttps(req: NextApiRequest): boolean {
  const proto = (req.headers['x-forwarded-proto'] as string) || '';
  return proto.split(',')[0].trim() === 'https';
}

function cookieAttrs(req: NextApiRequest, maxAge: number): string {
  return [
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
    isHttps(req) ? 'Secure' : '',
  ].filter(Boolean).join('; ');
}

export function setStateCookie(
  res: NextApiResponse,
  req: NextApiRequest,
  claim: OIDCStateClaim,
): void {
  const token = jwt.sign(claim as object, secret(), {expiresIn: STATE_TTL_SECONDS});
  res.setHeader('Set-Cookie', `${STATE_COOKIE}=${token}; ${cookieAttrs(req, STATE_TTL_SECONDS)}`);
}

export function consumeStateCookie(
  req: NextApiRequest,
  res: NextApiResponse,
): OIDCStateClaim | null {
  const cookieHeader = req.headers.cookie || '';
  const match = cookieHeader.split(/;\s*/).find(c => c.startsWith(`${STATE_COOKIE}=`));

  // Always clear the cookie so a single state can only be consumed once.
  res.setHeader('Set-Cookie', `${STATE_COOKIE}=; ${cookieAttrs(req, 0)}`);

  if (!match) return null;
  const token = match.substring(STATE_COOKIE.length + 1);

  try {
    const payload = jwt.verify(token, secret()) as OIDCStateClaim;
    if (!payload?.state || !payload?.codeVerifier || !payload?.redirectUri) return null;
    return payload;
  } catch {
    return null;
  }
}
