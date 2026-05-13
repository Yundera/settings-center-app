import {NextApiResponse} from 'next';

// Append a Set-Cookie header without clobbering any prior value. Use this
// instead of `res.setHeader('Set-Cookie', ...)` whenever a handler may set
// more than one cookie (e.g. session + last_provider).
export function appendSetCookie(res: NextApiResponse, value: string): void {
  const existing = res.getHeader('Set-Cookie');
  if (!existing) {
    res.setHeader('Set-Cookie', value);
  } else if (Array.isArray(existing)) {
    res.setHeader('Set-Cookie', [...existing, value]);
  } else {
    res.setHeader('Set-Cookie', [String(existing), value]);
  }
}
