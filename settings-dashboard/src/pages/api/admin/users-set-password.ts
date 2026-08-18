import {NextApiRequest, NextApiResponse} from 'next';
import {adminMiddleware} from '@/backend/auth/middleware';
import {revokeGateSessions} from '@/backend/auth/gateControl';
import {SessionUser} from '@/backend/auth/session';
import {gateSessionId} from '@/backend/auth/gateIdentity';
import {describeUserError, resetPassword, validateUsername} from '@/backend/server/Users/AutheliaUsers';

export interface UsersSetPasswordRequest {
    username: string;
}

export interface UsersSetPasswordResponse {
    username: string;
    /** Plaintext one-time password — shown once, never retrievable again. */
    password: string;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({error: 'Method not allowed'});
    }

    const {username}: UsersSetPasswordRequest = req.body || {};

    const invalid = validateUsername(username);
    if (invalid) {
        return res.status(400).json({error: invalid});
    }

    try {
        const credential = await resetPassword(username);

        // A password reset is normally a response to that password being
        // compromised, so it has to end sessions opened with the old one — the
        // new password alone does nothing to a session already in someone's
        // hands.
        //
        // Resetting your OWN password would otherwise bounce you to the login
        // screen the instant the one-time-password dialog closed — on a
        // single-account box that is the common case, not the edge case. So the
        // browser doing the reset is spared by session id: every other session
        // for the account is cut, this one survives. The caller has already
        // cleared adminMiddleware, so nothing is granted here that they did not
        // have a moment ago.
        const caller = (req as any).user as SessionUser | undefined;
        const spare = caller && caller.id === username ? gateSessionId(req.headers) : null;
        await revokeGateSessions({user: username, ...(spare ? {except: spare} : {})});

        res.setHeader('Cache-Control', 'no-store');
        res.status(200).json(credential satisfies UsersSetPasswordResponse);
    } catch (error) {
        res.status(500).json({error: describeUserError(error)});
    }
}

export default adminMiddleware(handler);
