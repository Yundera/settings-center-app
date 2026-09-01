/**
 * Where to send the browser once onboarding is done.
 *
 * Maison's first-run gate (internal/server/onboarding.go) replaces its dashboard
 * with an interstitial while this box still owes a setup step, and links here
 * with `?return=<the address the owner is actually using>`. It cannot be a fixed
 * value on either side: a PCS answers on its gateway domain and on the nip.io and
 * sslip.io fallbacks at once, and only the browser knows which one is in play.
 *
 * WHICH MAKES IT AN OPEN REDIRECT IF TAKEN AS GIVEN. This app is served on an
 * internet-facing host, so `?return=` is attacker-supplied by definition — a link
 * to `admin-<domain>/?return=https://evil.example` would bounce a freshly
 * authenticated owner straight off the box. It is validated against the host this
 * page was served on, never against configuration.
 */

/**
 * The PCS's own domain, derived from the hostname this dashboard is served on.
 *
 * The admin app and every other app are routed at parallel labels —
 * `admin-${DOMAIN}`, `maison-${DOMAIN}`, `${DOMAIN}` — for the gateway, nip.io
 * and sslip.io shapes alike. PcsWelcome.tsx and AccountPanel use the same trick
 * to find their sibling services; `window.APP_CONFIG.DOMAIN` is not an option,
 * because FRONTEND_PUBLIC_ENV publishes only BASE_PATH and the domain is
 * deliberately kept off the unauthenticated /api/brand payload.
 *
 * Returns null when this page is not on an `admin-` host, which is every
 * development and non-PCS deployment.
 */
const pcsDomain = (): string | null => {
    if (typeof window === 'undefined') return null;
    const prefix = 'admin-';
    const host = window.location.host;
    return host.startsWith(prefix) ? host.slice(prefix.length) : null;
};

/**
 * True if `host` is this box: its bare domain, or one of the `<app>-${DOMAIN}`
 * labels every app on it is published at.
 *
 * The dash matters. Matching a plain suffix would accept `evildomain.tld` for a
 * box at `domain.tld`, and matching `.${domain}` would accept a subdomain nobody
 * on this box controls while rejecting `maison-${domain}`, which is the one host
 * this is actually for.
 */
const isOwnHost = (host: string, domain: string): boolean =>
    host === domain || host.endsWith(`-${domain}`);

/**
 * The validated return target from the current URL, or null.
 *
 * Null on anything unexpected — absent, unparseable, a non-http scheme, a host
 * that is not this box, or a page that cannot tell which box it is on. Callers
 * then simply stay put, which is always a safe outcome: the owner is left on a
 * working dashboard rather than sent somewhere unverified.
 */
export const readReturnTarget = (search?: string): string | null => {
    if (typeof window === 'undefined') return null;

    const raw = new URLSearchParams(search ?? window.location.search).get('return');
    if (!raw) return null;

    const domain = pcsDomain();
    if (!domain) return null;

    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        return null; // relative or malformed — not something Maison sends
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (!isOwnHost(url.host, domain)) return null;

    return url.toString();
};
