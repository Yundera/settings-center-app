// pages/api/protected-route.ts

import {authMiddleware} from "@/backend/auth/middleware";
import {NextApiRequest, NextApiResponse} from "next";

async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.json({
    message: 'You are authorized to access this route',
  });
}

export default authMiddleware(handler);