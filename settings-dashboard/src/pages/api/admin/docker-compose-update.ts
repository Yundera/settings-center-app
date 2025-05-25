import { NextApiRequest, NextApiResponse } from 'next'
import { authMiddleware } from "@/backend/auth/middleware";
import { execute } from "@/backend/cmd/Executor";
import { getConfig } from "@/configuration/getConfigBackend";

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const composePath = getConfig("COMPOSE_FOLDER_PATH");

  try {
    // Change to compose directory
    const cdCommand = `cd ${composePath}`;

    // Pull latest images and update compose
    const updateCommand = 'docker compose pull && docker compose up -d';

    // Execute commands in sequence
    const { stdout, stderr } = await execute(`${cdCommand} && ${updateCommand}`);

    res.status(200).json({
      stdout,
      stderr: stderr || null
    })
  } catch (error) {
    res.status(500).json({
      error: 'Failed to update Docker Compose images',
      details: error.message
    })
  }
}

export default authMiddleware(handler);