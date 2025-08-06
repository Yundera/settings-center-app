import { NextApiRequest, NextApiResponse } from 'next';
import { authMiddleware } from '@/backend/auth/middleware';
import { executeHostCommand } from '@/backend/cmd/HostExecutor';
import { getConfig } from '@/configuration/getConfigBackend';
import path from 'path';

interface UpdateChannelRequest {
  updateUrl: string;
}

interface UpdateChannelResponse {
  success: boolean;
  message?: string;
  updateUrl?: string | null;
}

async function updateChannelHandler(req: NextApiRequest, res: NextApiResponse<UpdateChannelResponse>) {
  const remoteDataApp = getConfig("COMPOSE_FOLDER_PATH") || "/DATA/AppData/casaos/apps/yundera/";

  const envFilePath = path.join(remoteDataApp, '.env');

  try {
    if (req.method === 'GET') {
      // Read current UPDATE_URL value
      try {
        // Try to read the .env file
        const result = await executeHostCommand(`cat "${envFilePath}"`);
        const lines = result.stdout.split('\n');
        const updateUrlLine = lines.find(line => line.startsWith('UPDATE_URL='));
        
        let updateUrl: string | null = null;
        if (updateUrlLine) {
          updateUrl = updateUrlLine.substring('UPDATE_URL='.length) || null;
        }

        return res.status(200).json({
          success: true,
          updateUrl
        });
      } catch (error) {
        // File might not exist, return null
        return res.status(200).json({
          success: true,
          updateUrl: null
        });
      }
    }

    if (req.method === 'POST') {
      const { updateUrl }: UpdateChannelRequest = req.body;

      // Read current .env content or create if it doesn't exist
      let envContent = '';
      try {
        const result = await executeHostCommand(`cat "${envFilePath}"`);
        envContent = result.stdout;
      } catch (error) {
        // File doesn't exist, create empty content
        envContent = '';
      }

      const lines = envContent.split('\n');
      const updateUrlLineIndex = lines.findIndex(line => line.startsWith('UPDATE_URL='));

      // Update or add UPDATE_URL line
      const newUpdateUrlLine = `UPDATE_URL=${updateUrl}`;
      
      if (updateUrlLineIndex >= 0) {
        // Replace existing line
        lines[updateUrlLineIndex] = newUpdateUrlLine;
      } else {
        // Add new line, but avoid adding to completely empty file
        if (lines.length === 1 && lines[0] === '') {
          lines[0] = newUpdateUrlLine;
        } else {
          lines.push(newUpdateUrlLine);
        }
      }

      const newEnvContent = lines.join('\n');

      // Write the updated content back to the file
      // Create directory if it doesn't exist
      await executeHostCommand(`mkdir -p "${path.dirname(envFilePath)}"`);
      
      // Write the file using echo for atomic operation
      const escapedContent = newEnvContent.replace(/"/g, '\\"');
      await executeHostCommand(`echo "${escapedContent}" > "${envFilePath}"`);

      return res.status(200).json({
        success: true,
        message: 'Update channel saved successfully'
      });
    }

    return res.status(405).json({
      success: false,
      message: 'Method not allowed'
    });

  } catch (error) {
    console.error('Error managing update channel:', error);
    return res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Unknown error occurred'
    });
  }
}

export default authMiddleware(updateChannelHandler);