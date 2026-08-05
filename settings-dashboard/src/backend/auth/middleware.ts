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

// Group that grants administrative rights on the PCS. Set on the seeded `admin`
// user by the template's ensure-authelia.sh, and assignable to further accounts
// from the Account panel.
export const ADMIN_ROLE = 'admin';

/**
 * Like authMiddleware, but additionally requires the session to carry
 * role=admin (derived from the OIDC `groups` claim in
 * pages/api/auth/oidc/callback.ts).
 *
 * Every route under pages/api/admin/ must use this rather than authMiddleware.
 * A PCS can now hold more than one local account, and a plain account passing
 * authMiddleware would otherwise reach the terminal, the SSH key store, and
 * reboot. Hiding panels in App.tsx is cosmetic — this is the real gate.
 */
export function adminMiddleware(
  handler: (req: NextApiRequest, res: NextApiResponse) => Promise<void> | void,
) {
  return async (req: NextApiRequest, res: NextApiResponse) => {
    try {
      const user = await readSession(req);
      if (!user) {
        return res.status(401).json({message: 'Not authenticated'});
      }
      if (user.role !== ADMIN_ROLE) {
        return res.status(403).json({message: 'Administrator role required'});
      }
      (req as any).user = user;
      return handler(req, res);
    } catch (error) {
      console.error('Admin middleware error:', error);
      return res.status(500).json({message: 'Internal server error'});
    }
  };
}

// Helper for routes that want the typed session user without wrapping.
export async function getSessionUser(req: NextApiRequest): Promise<SessionUser | null> {
  return readSession(req);
}
