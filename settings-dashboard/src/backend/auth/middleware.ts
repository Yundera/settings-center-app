// middleware/auth.ts
import { NextApiRequest, NextApiResponse } from 'next';
import {verifyToken} from "@/backend/auth/jwt";

export function authMiddleware(
  handler: (req: NextApiRequest, res: NextApiResponse) => Promise<void>
) {
  return async (req: NextApiRequest, res: NextApiResponse) => {
    try {
      const authHeader = req.headers.authorization;

      if (!authHeader?.startsWith('Bearer ')) {
        return res.status(401).json({
          message: 'No token provided'
        });
      }

      const token = authHeader.split(' ')[1];
      const decoded = verifyToken(token);

      if (!decoded) {
        return res.status(401).json({
          message: 'Invalid token'
        });
      }

      // Add user info to request
      (req as any).user = decoded;

      // Continue to the actual handler
      return handler(req, res);
    } catch (error) {
      console.error('Auth middleware error:', error);
      return res.status(500).json({
        message: 'Internal server error'
      });
    }
  };
}