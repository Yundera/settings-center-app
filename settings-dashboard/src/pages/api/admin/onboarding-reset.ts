import {NextApiRequest, NextApiResponse} from 'next';
import {adminMiddleware} from '@/backend/auth/middleware';
import {revokeGateSessions} from '@/backend/auth/gateControl';
import {gateSessionId} from '@/backend/auth/gateIdentity';
import {describeFeatureError, getFeature} from '@/backend/server/Features/Features';
import {
    describeOnboardingError,
    resetOnboarding,
    type OnboardingResetResult,
} from '@/backend/server/Onboarding/Onboarding';

export interface OnboardingResetRequest {
    /** Mirrors the host script's mandatory `--confirm`. Must be exactly true. */
    confirm: boolean;
}

export interface OnboardingResetResponse extends OnboardingResetResult {
    /** Set when the reset happened but other gate sessions could not be ended. */
    warning?: string;
}

/**
 * "Re-run onboarding" (System Information panel) — `onboarding.sh reset`.
 *
 * Unclaims the PCS so the first-start wizard replays. Destructive: it disables
 * EVERY local account (the script keeps a `*.reset-backup` of the user DB) and
 * ensure-dex.sh withdraws the Local Account connector. Three things keep that
 * from stranding the owner:
 *
 *   - `confirm: true` is required, so a stray POST (a probe, a replayed request)
 *     cannot unclaim a live box; the UI makes the operator type `reset` first.
 *   - It refuses while Yundera Login is off: after the reset that connector is
 *     the only way back to the wizard, so without it the box would be reachable
 *     through the support SSH key alone. Reset from a terminal in that case.
 *   - Every OTHER session on this app's gate is revoked — the accounts they were
 *     opened with no longer exist — while the caller's is spared, so the reload
 *     lands them straight in the wizard.
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

    let yunderaLogin: boolean;
    try {
        yunderaLogin = await getFeature('yundera-login');
    } catch (error) {
        return res.status(500).json({error: `Could not check Yundera Login: ${describeFeatureError(error)}`});
    }
    if (!yunderaLogin) {
        return res.status(409).json({
            error: 'Yundera Login is off. After a reset it is the only way back to the setup wizard, so enable it first (Yundera Features), or reset from a terminal: onboarding.sh reset --confirm',
        });
    }

    let result: OnboardingResetResult;
    try {
        result = await resetOnboarding();
    } catch (error) {
        return res.status(500).json({error: describeOnboardingError(error)});
    }

    const response: OnboardingResetResponse = {...result};
    const own = gateSessionId(req.headers);
    const revoked = await revokeGateSessions({all: true, ...(own ? {except: own} : {})});
    if (revoked === null) {
        response.warning = 'Onboarding was reset, but other sessions on this admin app could not be ended.';
    }
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(response);
}

export default adminMiddleware(handler);
