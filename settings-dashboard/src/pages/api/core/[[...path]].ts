// pages/api/core/[[...path]].ts
import {NextApiRequest, NextApiResponse} from 'next';
import {BaseConfig, getConfig} from "@/core/backend/LocalBackendConfig";

/**
 * Serves the subset of the backend config the frontend is allowed to see.
 * The whitelist is the `FRONTEND_PUBLIC_ENV` array from core.env.json;
 * `loadBackendConfiguration()` (src/core/configuration) consumes the result.
 */
function getPublicConfig(): Record<string, any> {
  const publicConfig: Record<string, any> = {};
  const envKeys = getConfig<BaseConfig, string[]>("FRONTEND_PUBLIC_ENV") || [];
  for (const key of envKeys) {
    publicConfig[key] = getConfig<any, any>(key);
  }
  return publicConfig;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    const path = req.query.path || [];
    const pathStr = Array.isArray(path) ? path.join('/') : path;

    if (pathStr === 'config/core') {
      return res.status(200).json(getPublicConfig());
    }

    return res.status(404).json({error: 'Route not found'});
  } catch (error) {
    console.error(error.toString());
    return res.status(500).json({error: error.toString()});
  }
}
