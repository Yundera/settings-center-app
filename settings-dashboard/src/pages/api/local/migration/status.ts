import {NextApiRequest, NextApiResponse} from 'next';
import {loopbackOnly} from '@/backend/auth/loopbackOnly';
import {getMigrationStatus} from '@/backend/server/Migration/Migration';

/**
 * Loopback-only readout of the in-memory migration state. Mirrors the
 * authenticated `GET /api/admin/migration/status` route (same payload
 * shape) but without requiring a Firebase JWT, so the orchestrator can
 * poll source pipeline state via:
 *
 *   ssh -i $SSH_KEY admin@<srcHost> \
 *     'docker exec admin curl -sS http://127.0.0.1:80/api/local/migration/status'
 *
 * Replaces the old `docker exec admin cat /app/.../migration-status.json`
 * pattern, which broke when Migration.ts moved off JsonFileContext to
 * pure in-memory state. See AutoStatusProxy.ts in pcs-orchestrator.
 *
 * Auth model: see backend/auth/loopbackOnly.ts. Returns the same
 * `MigrationStatus` shape consumed by the dashboard's MigrationCard.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'GET') {
        return res.status(405).json({error: 'Method not allowed'});
    }
    const status = await getMigrationStatus();
    return res.status(200).json(status);
}

export default loopbackOnly(handler);
