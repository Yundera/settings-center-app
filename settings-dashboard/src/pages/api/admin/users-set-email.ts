import {NextApiRequest, NextApiResponse} from 'next';
import {adminMiddleware} from '@/backend/auth/middleware';
import {
    PROTECTED_USER,
    describeUserError,
    setEmail,
    validateEmail,
    validateUsername,
} from '@/backend/server/Users/AutheliaUsers';

export interface UsersSetEmailRequest {
    username: string;
    email: string;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({error: 'Method not allowed'});
    }

    const {username, email}: UsersSetEmailRequest = req.body || {};

    const invalid = validateUsername(username) ?? validateEmail(email);
    if (invalid) {
        return res.status(400).json({error: invalid});
    }

    // The host script refuses this too — it is the enforcing copy. Checking here
    // as well is about the status code: a request that can never succeed is a
    // client error, and letting the script fail would report it as a 500.
    if (username === PROTECTED_USER) {
        return res.status(400).json({
            error: `'${PROTECTED_USER}' email is managed by EMAIL in .ynd.user.env and is re-applied on every self-check; change it there instead`,
        });
    }

    try {
        await setEmail(username, email);
        res.setHeader('Cache-Control', 'no-store');
        res.status(200).json({status: 'success', username, email});
    } catch (error) {
        res.status(500).json({error: describeUserError(error)});
    }
}

export default adminMiddleware(handler);
