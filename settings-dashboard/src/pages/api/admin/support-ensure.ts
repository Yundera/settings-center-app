import { NextApiRequest, NextApiResponse } from 'next';
import { adminMiddleware } from "@/backend/auth/middleware";
import {
    disableSupportAccess,
    enableSupportAccess,
    getSupportAccessStatus,
} from "@/backend/server/Support/SupportAccess";
import {
    getEnsureSupportKey,
    setEnsureSupportKey,
} from "@/backend/server/Support/SupportEnsure";

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
            await setEnsureSupportKey(ensure);
            const applied = ensure
                ? await enableSupportAccess()
                : await disableSupportAccess();
            const accessStatus = await getSupportAccessStatus();
            return res.status(200).json({
                ensure,
                accessEnabled: accessStatus.enabled,
                username: accessStatus.username,
                fingerprint: accessStatus.fingerprint,
                comment: accessStatus.comment,
                appliedStatus: applied.status,
            });
        }
        return res.status(405).json({ error: 'Method not allowed' });
    } catch (error) {
        res.status(500).json({
            error: 'Support ensure operation failed',
            details: error instanceof Error ? error.message : String(error),
        });
    }
}

export default adminMiddleware(handler);
