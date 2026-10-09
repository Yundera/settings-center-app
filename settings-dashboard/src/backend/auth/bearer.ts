import {createHash, timingSafeEqual} from 'crypto';
import {IncomingMessage} from 'http';

/**
 * Whether the request carries `Authorization: Bearer <expected>`.
 *
 * Compared as SHA-256 digests so both sides are always 32 bytes: timingSafeEqual
 * throws on a length mismatch, and checking the length first would leak it. An
 * empty `expected` never matches — an unset secret must mean "nobody", not "anyone
 * who sends an empty token".
 */
export function hasBearer(req: IncomingMessage, expected: string): boolean {
    if (!expected) return false;
    const header = req.headers.authorization ?? '';
    const m = /^Bearer\s+(.+)$/i.exec(header);
    if (!m) return false;
    const digest = (s: string) => createHash('sha256').update(s, 'utf8').digest();
    return timingSafeEqual(digest(m[1].trim()), digest(expected));
}
