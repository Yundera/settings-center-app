import {NextApiRequest, NextApiResponse} from 'next';
import {adminMiddleware} from '@/backend/auth/middleware';
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
        res.setHeader('Cache-Control', 'no-store');
        res.status(200).json(credential satisfies UsersSetPasswordResponse);
    } catch (error) {
        res.status(500).json({error: describeUserError(error)});
    }
}

export default adminMiddleware(handler);
