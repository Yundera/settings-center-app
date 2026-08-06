import {NextApiRequest, NextApiResponse} from 'next';
import {authMiddleware} from '@/backend/auth/middleware';
import {
    describeOnboardingError,
    getOnboardingStatus,
    type OnboardingStatus,
} from '@/backend/server/Onboarding/Onboarding';

/**
 * Read-only onboarding state, polled by the first-start gate in the app shell.
 *
 * authMiddleware, not adminMiddleware: this only reports whether the box has a
 * credential yet, and the gate runs for whoever is signed in. The mutating
 * routes are admin-gated.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'GET') {
        return res.status(405).json({error: 'Method not allowed'});
    }

    try {
        const status = await getOnboardingStatus();
        res.setHeader('Cache-Control', 'no-store');
        res.status(200).json(status satisfies OnboardingStatus);
    } catch (error) {
        res.status(500).json({error: describeOnboardingError(error)});
    }
}

export default authMiddleware(handler);
