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

  const envFilePath = path.join(remoteDataApp, '.pcs.env');
  // Per-key atomic edits via env-file-manager.sh — never round-trip the whole
  // file. The previous read-modify-write design silently truncated .pcs.env
  // when `cat` failed (file mode 0600 owned by pcs after env-file-manager's
  // mv-from-mktemp side-effect), losing every other key (YND_PROVIDER,
  // YUNDERA_USER_API, PUBLIC_IP*, ...).
  const envMgr = path.join(remoteDataApp, 'scripts/tools/env-file-manager.sh');

  try {
    if (req.method === 'GET') {
      try {
        const result = await executeHostCommand(
          `sudo -n "${envMgr}" get UPDATE_URL "${envFilePath}"`
        );
        const updateUrl = result.stdout.trim() || null;
        return res.status(200).json({ success: true, updateUrl });
      } catch (error) {
        // Distinct from the old code: no silent truncation. A read failure
        // surfaces as a 500 so the operator sees it instead of clobbering
        // the file on the subsequent save.
        return res.status(500).json({
          success: false,
          message: error instanceof Error ? error.message : 'Failed to read update channel'
        });
      }
    }

    if (req.method === 'POST') {
      const { updateUrl }: UpdateChannelRequest = req.body;

      // Reject anything that would break out of single-quote shell quoting,
      // newlines, or absurd lengths. Empty string is allowed (clears the key).
      if (typeof updateUrl !== 'string' || updateUrl.includes("'") || /[\r\n]/.test(updateUrl) || updateUrl.length > 2048) {
        return res.status(400).json({
          success: false,
          message: 'Invalid updateUrl'
        });
      }

      await executeHostCommand(
        `sudo -n "${envMgr}" set UPDATE_URL '${updateUrl}' "${envFilePath}"`
      );

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