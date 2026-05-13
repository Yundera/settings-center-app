import crypto from 'crypto';
import {NextApiRequest} from 'next';

// Double-submit cookie pattern. The chooser page issues a random token in a
// non-HttpOnly cookie + embeds the same value in a hidden form field. The
// CasaOS login handler accepts the form POST only when both values match.
//
// SameSite=Lax + same-origin already protects against the classic CSRF
// attack vectors here, but the token adds a cheap second factor and removes
// one assumption from the threat model.

export const CSRF_COOKIE = 'admin_csrf';
const CSRF_TTL_SECONDS = 60 * 60; // 1 hour

export function newCsrfToken(): string {
  return crypto.randomBytes(24).toString('base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

export function csrfCookieAttrs(secure: boolean): string {
  return [
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${CSRF_TTL_SECONDS}`,
    secure ? 'Secure' : '',
  ].filter(Boolean).join('; ');
}

export function readCsrfCookie(req: NextApiRequest): string | null {
  const cookieHeader = req.headers.cookie || '';
  const match = cookieHeader.split(/;\s*/).find(c => c.startsWith(`${CSRF_COOKIE}=`));
  if (!match) return null;
  return match.substring(CSRF_COOKIE.length + 1) || null;
}

export function validateCsrf(req: NextApiRequest, submitted: string | undefined): boolean {
  const cookieToken = readCsrfCookie(req);
  if (!cookieToken || !submitted) return false;
  // Constant-time compare — the token is short, but cheap to do right.
  if (cookieToken.length !== submitted.length) return false;
  const a = Buffer.from(cookieToken);
  const b = Buffer.from(submitted);
  return crypto.timingSafeEqual(a, b);
}
