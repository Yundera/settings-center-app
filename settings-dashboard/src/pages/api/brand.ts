import {NextApiRequest, NextApiResponse} from 'next';
import {resolveBrand} from '@/brand/resolveBrand';

/**
 * Public brand configuration.
 *
 * Serves the resolved brand name, logo, and provider dashboard link so one
 * image can render as either stack. Unauthenticated by necessity: the /login
 * chooser needs the logo and title before a session exists.
 *
 * Safe to leave public for the same reason /api/health is — it does no shell,
 * no SSH, and no work on demand. The only I/O is a stat() of brand.json,
 * memoised for 10s inside loadBrandFile(). There is no user input to reflect.
 *
 * The payload is PRE-RESOLVED (see resolveBrand.ts): DOMAIN and YUNDERA_API
 * are consumed server-side and reduced to a link plus a boolean. Nothing from
 * .pcs.secret.env may ever be added to it.
 */
export default function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        return res.status(405).json({error: 'Method not allowed'});
    }

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(resolveBrand());
}
