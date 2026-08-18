import {NextApiRequest, NextApiResponse} from 'next';
import {loopbackOnly} from '@/backend/auth/loopbackOnly';
import {startMigration} from '@/backend/server/Migration/Migration';

/**
 * Loopback-only entrypoint for triggering a migration without a Firebase JWT.
 *
 * Reached via the Path C trigger:
 *   ssh -i $SSH_KEY admin@<srcHost> \
 *     'docker exec -i admin-app /app/settings-dashboard/scripts/start-migration.sh' \
 *     <<< '<json-payload>'
 *
 * The script does an HTTP POST to http://127.0.0.1:80/api/local/migration/start
 * inside the admin container. The migration then runs in the long-lived
 * Next.js server process — same process that handles the authenticated
 * `POST /api/admin/migration/start` route. Both call `startMigration(req)`
 * with the same shape; the only difference is `triggeredBy: 'cli'` here vs
 * 'ui' there.
 *
 * Auth model: see backend/auth/loopbackOnly.ts.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({error: 'Method not allowed'});
    }
    const {host, user, password, webhookUrl} = (req.body ?? {}) as Record<string, unknown>;
    if (typeof host !== 'string' || !host) {
        return res.status(400).json({error: 'host is required'});
    }
    if (typeof user !== 'string' || !user) {
        return res.status(400).json({error: 'user is required'});
    }
    if (typeof password !== 'string' || !password) {
        return res.status(400).json({error: 'password is required'});
    }
    if (webhookUrl !== undefined && typeof webhookUrl !== 'string') {
        return res.status(400).json({error: 'webhookUrl must be a string when provided'});
    }
    try {
        const status = await startMigration({
            host,
            user,
            password,
            webhookUrl,
            triggeredBy: 'cli',
        });
        return res.status(200).json(status);
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const code = /already in progress/i.test(msg) ? 409 : 500;
        return res.status(code).json({error: 'Failed to start migration', details: msg});
    }
}

export default loopbackOnly(handler);
