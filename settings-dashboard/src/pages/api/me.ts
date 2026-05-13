import {NextApiRequest, NextApiResponse} from 'next';
import {readSession} from '@/backend/auth/session';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({message: 'Method not allowed'});
  const user = await readSession(req);
  if (!user) return res.status(401).json({message: 'Not authenticated'});
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({user});
}
