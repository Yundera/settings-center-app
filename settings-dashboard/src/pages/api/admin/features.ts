import {NextApiRequest, NextApiResponse} from 'next';
import {adminMiddleware} from '@/backend/auth/middleware';
import {
    describeFeatureError,
    getFeature,
    getFeatures,
    isFeatureId,
    setFeature,
    type FeatureId,
    type FeatureState,
} from '@/backend/server/Features/Features';
import {getOnboardingStatus} from '@/backend/server/Onboarding/Onboarding';

/**
 * The optional Yundera services, and their off switches.
 *
 * GET  -> {features: FeatureState[]}
 * POST {id, enabled} -> the new FeatureState
 *
 * THE LOCKOUT GUARDS LIVE HERE, not in the host scripts and not only in the
 * panel. The scripts deliberately do not police their caller — anyone who can
 * run them already has root and could edit .pcs.env by hand, so a guard there
 * buys nothing. But this route is reachable by anyone with an admin session and
 * a curl, so the check has to hold without the UI's cooperation. The panel
 * disables the same switches with a visible reason; this is what makes it true.
 *
 * Both guards are about the same thing: leaving nobody able to sign in. Dex
 * offers no Local Account connector until a local account exists (ensure-dex.sh
 * gates it on the same predicate onboarding.sh reports as `claimed`), so on an
 * unclaimed box Yundera Login is the only interactive login there is.
 */

interface Guard {
    /** Why this must not be turned off right now, or null if it may be. */
    reason: string | null;
}

async function guardDisable(id: FeatureId): Promise<Guard> {
    if (id !== 'yundera-login' && id !== 'support-key') {
        return {reason: null};
    }

    // Both guards need it, and it is one SSH round trip on an already-open
    // multiplexed connection.
    const {claimed} = await getOnboardingStatus();
    if (claimed) {
        return {reason: null};
    }

    if (id === 'yundera-login') {
        return {
            reason:
                'This server has no local account yet, so Yundera Login is the only way to sign in. ' +
                'Create a local account first — turning this off now would leave the support SSH key as the only way back in.',
        };
    }

    // support-key on an unclaimed box: fine on its own (Yundera Login still
    // works), fatal in combination.
    const loginEnabled = await getFeature('yundera-login').catch(() => true);
    if (!loginEnabled) {
        return {
            reason:
                'This server has no local account and Yundera Login is already off, so the support key is the only remaining way in. ' +
                'Create a local account, or turn Yundera Login back on, first.',
        };
    }
    return {reason: null};
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
    try {
        if (req.method === 'GET') {
            const features = await getFeatures();
            res.setHeader('Cache-Control', 'no-store');
            return res.status(200).json({features} satisfies {features: FeatureState[]});
        }

        if (req.method === 'POST') {
            const {id, enabled} = (req.body || {}) as {id?: unknown; enabled?: unknown};
            if (!isFeatureId(id)) {
                return res.status(400).json({error: 'Body must include a known feature { id }'});
            }
            if (typeof enabled !== 'boolean') {
                return res.status(400).json({error: 'Body must include { enabled: boolean }'});
            }

            if (!enabled) {
                const {reason} = await guardDisable(id);
                if (reason) {
                    return res.status(409).json({error: reason});
                }
            }

            const state = await setFeature(id, enabled);
            return res.status(200).json(state satisfies FeatureState);
        }

        return res.status(405).json({error: 'Method not allowed'});
    } catch (error) {
        return res.status(500).json({
            error: 'Feature toggle failed',
            details: describeFeatureError(error),
        });
    }
}

export default adminMiddleware(handler);
