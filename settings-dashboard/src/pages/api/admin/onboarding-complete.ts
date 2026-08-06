import {NextApiRequest, NextApiResponse} from 'next';
import {adminMiddleware} from '@/backend/auth/middleware';
import {describeOnboardingError, markOnboardingCompleted} from '@/backend/server/Onboarding/Onboarding';

/**
 * Dismisses the welcome screen — writes the marker and nothing else.
 *
 * Only reachable when the box is already claimed (the gate blocks otherwise), so
 * this can never be used to skip setting a credential. It exists for the box
 * that was onboarded from a terminal and whose owner then sees the welcome once.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({error: 'Method not allowed'});
    }

    try {
        await markOnboardingCompleted();
        res.setHeader('Cache-Control', 'no-store');
        res.status(200).json({completed: true});
    } catch (error) {
        res.status(500).json({error: describeOnboardingError(error)});
    }
}

export default adminMiddleware(handler);
