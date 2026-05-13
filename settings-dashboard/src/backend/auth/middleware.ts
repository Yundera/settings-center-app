import {NextApiRequest, NextApiResponse} from 'next';
import {readSession, SessionUser} from './session';

export function authMiddleware(
  handler: (req: NextApiRequest, res: NextApiResponse) => Promise<void> | void,
) {
  return async (req: NextApiRequest, res: NextApiResponse) => {
    try {
      const user = await readSession(req);
      if (!user) {
        return res.status(401).json({message: 'Not authenticated'});
      }
      (req as any).user = user;
      return handler(req, res);
    } catch (error) {
      console.error('Auth middleware error:', error);
      return res.status(500).json({message: 'Internal server error'});
    }
  };
}

// Helper for routes that want the typed session user without wrapping.
export async function getSessionUser(req: NextApiRequest): Promise<SessionUser | null> {
  return readSession(req);
}
