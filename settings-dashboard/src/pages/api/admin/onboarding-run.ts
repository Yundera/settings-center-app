import {NextApiRequest, NextApiResponse} from 'next';
import {adminMiddleware} from '@/backend/auth/middleware';
import {
    describeOnboardingError,
    runOnboarding,
    validateDisplayname,
    validatePassword,
    validateUsername,
    type OnboardingResult,
} from '@/backend/server/Onboarding/Onboarding';

export interface OnboardingRunRequest {
    username: string;
    displayname: string;
    /** Omitted when `generate` is set. */
    password?: string;
    generate?: boolean;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({error: 'Method not allowed'});
    }

    const {username, displayname, password, generate}: OnboardingRunRequest = req.body || {};

    const invalid =
        validateUsername(username) ??
        validateDisplayname(displayname) ??
        (generate ? null : validatePassword(password ?? ''));
    if (invalid) {
        return res.status(400).json({error: invalid});
    }

    try {
        const result = await runOnboarding({
            username,
            displayname: displayname.trim(),
            password,
            generate: !!generate,
        });
        res.setHeader('Cache-Control', 'no-store');
        res.status(200).json(result satisfies OnboardingResult);
    } catch (error) {
        // The host script refuses to onboard an already-claimed box; that is a
        // client-state problem, not a server fault.
        const message = describeOnboardingError(error);
        const status = /already onboarded|already claimed/i.test(message) ? 409 : 500;
        res.status(status).json({error: message});
    }
}

export default adminMiddleware(handler);
