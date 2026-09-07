import { NextApiRequest, NextApiResponse } from 'next';
import { adminMiddleware } from "@/backend/auth/middleware";
import { getSupportAccessStatus } from "@/backend/server/Support/SupportAccess";
import { getEnsureSupportKey } from "@/backend/server/Support/SupportEnsure";
import { describeFeatureError, setFeature } from "@/backend/server/Features/Features";

/**
 * Durable support-access toggle.
 *
 * GET — returns the current ensure flag (.pcs.env) plus the live key
 * presence in admin's authorized_keys, so the UI can show both
 * "intent" and "actual state" if they ever diverge (e.g. a manual
 * key edit between toggle and next self-check).
 *
 * POST { ensure: boolean } — writes the durable flag *and* immediately
 * applies it (add/remove the key). The two together avoid the
 * "I disabled it and it came back" surprise — the next self-check
 * tick won't re-add it because the flag now says opt-out.
 *
 * The write goes through feature-support-key.sh (Features.ts), which is the
 * same script the Yundera Features panel drives. THAT IS THE POINT: three
 * surfaces now offer this switch — here, the Access panel's card, and the
 * Features page — and a second implementation of "what off means" is how they
 * would drift apart. The script already does both halves (flag + immediate
 * removal by fingerprint), so nothing is lost by delegating, and its failure
 * mode is the one this route always had: both paths need the orchestrator's
 * /support/ssh-key to identify the key.
 *
 * The GET deliberately stays local — it reports intent AND reality, which the
 * script does not, and which is what the two panels render.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
    try {
        if (req.method === 'GET') {
            const [ensureState, accessStatus] = await Promise.all([
                getEnsureSupportKey(),
                getSupportAccessStatus(),
            ]);
            res.setHeader('Cache-Control', 'no-store');
            return res.status(200).json({
                ensure: ensureState.ensure,
                rawValue: ensureState.rawValue,
                accessEnabled: accessStatus.enabled,
                username: accessStatus.username,
                fingerprint: accessStatus.fingerprint,
                comment: accessStatus.comment,
            });
        }
        if (req.method === 'POST') {
            const { ensure } = (req.body || {}) as { ensure?: boolean };
            if (typeof ensure !== 'boolean') {
                return res.status(400).json({ error: 'Body must include { ensure: boolean }' });
            }
            await setFeature('support-key', ensure);
            const accessStatus = await getSupportAccessStatus();
            return res.status(200).json({
                ensure,
                accessEnabled: accessStatus.enabled,
                username: accessStatus.username,
                fingerprint: accessStatus.fingerprint,
                comment: accessStatus.comment,
                // Observed after the fact rather than reported by the operation,
                // now that the host script owns the add/remove.
                appliedStatus: accessStatus.enabled ? 'present' : 'absent',
            });
        }
        return res.status(405).json({ error: 'Method not allowed' });
    } catch (error) {
        res.status(500).json({
            error: 'Support ensure operation failed',
            details: describeFeatureError(error),
        });
    }
}

export default adminMiddleware(handler);
