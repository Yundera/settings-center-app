import {NextApiRequest, NextApiResponse} from 'next';
import {adminMiddleware} from '@/backend/auth/middleware';
import {deleteUser, describeUserError, validateUsername} from '@/backend/server/Users/AutheliaUsers';

export interface UsersDeleteRequest {
    username: string;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({error: 'Method not allowed'});
    }

    const {username}: UsersDeleteRequest = req.body || {};

    const invalid = validateUsername(username);
    if (invalid) {
        return res.status(400).json({error: invalid});
    }

    // The host script already refuses to remove `admin` or the last member of
    // `admins`. This guard is the one it cannot make: an admin deleting the
    // account they are currently signed in as. Legal, but never intentional.
    const caller = (req as any).user?.id;
    if (caller && caller === username) {
        return res.status(400).json({error: 'You cannot delete the account you are signed in as'});
    }

    try {
        await deleteUser(username);
        res.setHeader('Cache-Control', 'no-store');
        res.status(200).json({status: 'success', username});
    } catch (error) {
        res.status(500).json({error: describeUserError(error)});
    }
}

export default adminMiddleware(handler);
