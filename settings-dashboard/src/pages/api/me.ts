import {NextApiRequest, NextApiResponse} from 'next';
import {readSession} from '@/backend/auth/session';
import {getConfig} from '@/configuration/getConfigBackend';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({message: 'Method not allowed'});
  const user = await readSession(req);
  if (!user) return res.status(401).json({message: 'Not authenticated'});
  res.setHeader('Cache-Control', 'no-store');
  // `upstreamLogoutUrl` rides along here rather than on a route of its own: it is
  // session metadata, the SPA already calls this endpoint, and being behind the
  // 401 above means only a signed-in caller learns it. Null when the deployment
  // configures no upstream IdP logout — the client then just ends the gate
  // session. See configuration/getConfigBackend.ts.
  res.status(200).json({user, upstreamLogoutUrl: getConfig('UPSTREAM_LOGOUT_URL') || null});
}
