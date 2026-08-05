import {NextApiRequest, NextApiResponse} from 'next';
import {adminMiddleware} from '@/backend/auth/middleware';
import {AutheliaUser, listUsers, describeUserError} from '@/backend/server/Users/AutheliaUsers';

export interface UsersListResponse {
    users: AutheliaUser[];
    /** Username of the caller, so the UI can lock destructive controls on self. */
    currentUser: string;
    collectedAt: string;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'GET') {
        return res.status(405).json({error: 'Method not allowed'});
    }

    try {
        const users = await listUsers();
        const response: UsersListResponse = {
            users,
            currentUser: (req as any).user?.id ?? '',
            collectedAt: new Date().toISOString(),
        };
        res.setHeader('Cache-Control', 'no-store');
        res.status(200).json(response);
    } catch (error) {
        res.status(500).json({error: describeUserError(error)});
    }
}

export default adminMiddleware(handler);
