import {NextApiRequest, NextApiResponse} from 'next';
import {takeKey} from '@/backend/identity/ephemeralKeys';
import {BundleRejected, openBundle} from '@/backend/identity/verifyBundle';
import {issuerKeySet, trustedIssuer} from '@/backend/identity/trust';
import {applyIdentity, hostAddresses, lastAppliedIat} from '@/backend/identity/applyIdentity';
import {windowLimiter} from '@/backend/identity/rateLimit';

/**
 * Public: receive an identity bundle from the operator and apply it
 * (pcs-orchestrator doc/identity-push.md). The bundle is the authentication:
 * it must decrypt with a key we just issued, be signed by the trusted issuer's
 * key set as a `pcs-identity` token, name an address of this machine as `host`,
 * and be newer than the last bundle applied. Only then is anything written.
 *
 * Answers 204 once applied, 4xx with a short reason otherwise — the operator
 * records the reason as the box's delivery state.
 */
export const config = {api: {bodyParser: {sizeLimit: '32kb'}}};

const allow = windowLimiter(10, 60_000);

// One push at a time: two concurrent applies would race on the env files.
let busy = false;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({error: 'Method not allowed'});
    }
    if (!allow()) return res.status(429).json({error: 'Too many requests'});
    if (busy) return res.status(409).json({error: 'Another push is being applied'});

    busy = true;
    try {
        const issuer = await trustedIssuer();
        const verified = await openBundle(req.body?.jwe, takeKey, issuer, await issuerKeySet(issuer));

        if (!(await hostAddresses()).has(verified.host)) {
            return res.status(403).json({error: 'host mismatch'});
        }
        if (verified.iat <= await lastAppliedIat()) {
            return res.status(409).json({error: 'stale bundle'});
        }

        const {identityChanged} = await applyIdentity(verified.bundle, verified.iat);
        console.log(`[identity] applied a pushed identity (iat ${verified.iat})${identityChanged ? ', domain identity changed: self-check started' : ''}`);
        return res.status(204).end();
    } catch (e) {
        if (e instanceof BundleRejected) {
            console.warn(`[identity] push rejected: ${e.message}`);
            return res.status(400).json({error: e.message.slice(0, 80)});
        }
        console.error('[identity] push failed:', e);
        return res.status(500).json({error: 'apply failed'});
    } finally {
        busy = false;
    }
}
