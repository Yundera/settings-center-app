import {NextApiRequest, NextApiResponse} from 'next';
import {clearSession} from '@/backend/auth/session';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  clearSession(req, res);
  if (req.method === 'POST') {
    return res.status(204).end();
  }
  // GET (e.g. user clicks a logout link): bounce them back to the chooser.
  res.redirect(302, '/login');
}
