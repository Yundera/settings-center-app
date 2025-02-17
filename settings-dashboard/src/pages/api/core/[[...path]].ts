// pages/api/core/[[...path]].ts
import {NextApiRequest, NextApiResponse} from 'next';
import {coreApiHandler} from "dashboard-core/backend/config/CoreApiHandler";
import {createHandlerConfig, genericApiHandler} from "dashboard-core/backend/ApiHandlerBuilder";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  return genericApiHandler(
    createHandlerConfig({
      'config': coreApiHandler,
    }), req, res);
}