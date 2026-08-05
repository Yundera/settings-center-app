import {NextApiRequest, NextApiResponse} from 'next';
import {adminMiddleware} from '@/backend/auth/middleware';
import {
    addUser,
    describeUserError,
    validateDisplayname,
    validateEmail,
    validateUsername,
} from '@/backend/server/Users/AutheliaUsers';

export interface UsersAddRequest {
    username: string;
    displayname: string;
    email: string;
    isAdmin?: boolean;
}

export interface UsersAddResponse {
    username: string;
    /**
     * Plaintext one-time password, minted inside the Authelia container by
     * `crypto hash generate argon2 --random`. This is the only time it exists
     * outside the argon2 digest — the UI must show it and say so.
     */
    password: string;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({error: 'Method not allowed'});
    }

    const {username, displayname, email, isAdmin}: UsersAddRequest = req.body || {};

    const invalid =
        validateUsername(username) ?? validateDisplayname(displayname) ?? validateEmail(email);
    if (invalid) {
        return res.status(400).json({error: invalid});
    }

    try {
        const created = await addUser({
            username,
            displayname: displayname.trim(),
            email,
            isAdmin: !!isAdmin,
        });
        res.setHeader('Cache-Control', 'no-store');
        res.status(200).json(created satisfies UsersAddResponse);
    } catch (error) {
        res.status(500).json({error: describeUserError(error)});
    }
}

export default adminMiddleware(handler);
