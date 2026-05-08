import {NextApiRequest, NextApiResponse} from 'next';

/**
 * Wraps a Next.js API handler, allowing only requests whose TCP peer is the
 * loopback address. Used by routes that are intentionally unauthenticated
 * because the only callers are processes running inside this container.
 *
 * Trust chain (Path C, see doc/architecture/migration.md):
 *   support-key SSH → docker exec admin → loopback HTTP → this handler
 *
 * Each link is something the user explicitly enabled. The loopback gate
 * exists so that a misconfigured reverse proxy or a leaked internal route
 * cannot escalate a network-reachable request into an admin-equivalent one.
 *
 * We deliberately do not honour `X-Forwarded-For` or any proxy header —
 * loopback means *the TCP peer is loopback*, not "claims to be."
 */
export function loopbackOnly(
    handler: (req: NextApiRequest, res: NextApiResponse) => Promise<void> | void,
) {
    return async (req: NextApiRequest, res: NextApiResponse) => {
        const peer = req.socket?.remoteAddress ?? '';
        // Node reports IPv4 loopback as either '127.0.0.1' or, on dual-stack
        // sockets, the IPv4-mapped form '::ffff:127.0.0.1'. IPv6 loopback is
        // '::1'. Anything else came from the network.
        const isLoopback =
            peer === '127.0.0.1' ||
            peer === '::1' ||
            peer === '::ffff:127.0.0.1';
        if (!isLoopback) {
            return res.status(403).json({error: 'loopback only'});
        }
        return handler(req, res);
    };
}
