import {NextApiRequest, NextApiResponse} from 'next';
import {issueKey} from '@/backend/identity/ephemeralKeys';
import {windowLimiter} from '@/backend/identity/rateLimit';

/**
 * Public: a one-time X25519 key the operator encrypts an identity bundle to
 * before posting it to /api/identity/push. Holds no secret worth guarding —
 * the bundle's signature is what authenticates a push.
 *
 * Bypasses both the AppShield gate (ALLOWED_PATHS in template-root) and
 * serverGate.ts. Contract: pcs-orchestrator doc/identity-push.md.
 */
const allow = windowLimiter(30, 60_000);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        return res.status(405).json({error: 'Method not allowed'});
    }
    if (!allow()) return res.status(429).json({error: 'Too many requests'});

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(await issueKey());
}
