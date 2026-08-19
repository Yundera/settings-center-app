import {NextApiRequest, NextApiResponse} from 'next';
import {adminMiddleware} from '@/backend/auth/middleware';
import {
    describeOnboardingError,
    resetOnboarding,
    type OnboardingResetResult,
} from '@/backend/server/Onboarding/Onboarding';

export interface OnboardingResetRequest {
    /** Mirrors the host script's mandatory `--confirm`. Must be exactly true. */
    confirm: boolean;
}

/**
 * Unclaims the PCS so the first-start wizard replays — `onboarding.sh reset`.
 *
 * Destructive and self-inflicted: it disables EVERY local account on the box,
 * the onboarding gate blocks the caller's own session on the next load, and
 * ensure-dex.sh withdraws the Local Account connector. onboarding.sh's header
 * argues this should stay terminal-only for exactly that reason; it is exposed
 * here because operators need to replay onboarding without an SSH session, and
 * the UI states the consequence before it lets anyone through.
 *
 * The `confirm` flag is not ceremony — it is what stops a stray POST (a probe, a
 * mistyped fetch, a replayed request) from unclaiming a live PCS.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({error: 'Method not allowed'});
    }

    const {confirm}: Partial<OnboardingResetRequest> = req.body || {};
    if (confirm !== true) {
        return res.status(400).json({
            error: 'Resetting onboarding disables every local account on this PCS; send {"confirm": true} to proceed',
        });
    }

    try {
        const result = await resetOnboarding();
        res.setHeader('Cache-Control', 'no-store');
        res.status(200).json(result satisfies OnboardingResetResult);
    } catch (error) {
        res.status(500).json({error: describeOnboardingError(error)});
    }
}

export default adminMiddleware(handler);
