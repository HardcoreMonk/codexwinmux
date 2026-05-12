import os from 'os';
import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { verifyRuntimeV2ApiAuth } from '@/lib/runtime/api-auth';
import { parseRuntimeApiBody, sendRuntimeApiError, sendRuntimeDisabled } from '@/lib/runtime/api-handler';
import { isRuntimeV2Enabled } from '@/lib/runtime/env';
import { getRuntimeSupervisor } from '@/lib/runtime/supervisor';

const createWorkspaceBodySchema = z.object({
  name: z.string().trim().min(1).optional(),
  defaultCwd: z.string().trim().min(1).optional(),
});

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  if (!isRuntimeV2Enabled()) {
    return sendRuntimeDisabled(res);
  }

  if (!(await verifyRuntimeV2ApiAuth(req))) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const supervisor = getRuntimeSupervisor();
    await supervisor.ensureStarted();
    if (req.method === 'GET') {
      const workspaces = await supervisor.listWorkspaces();
      return res.status(200).json({ workspaces });
    }

    const body = parseRuntimeApiBody(createWorkspaceBodySchema, req.body ?? {});
    const workspace = await supervisor.createWorkspace({
      name: body.name ?? 'Runtime Workspace',
      defaultCwd: body.defaultCwd ?? os.homedir(),
    });
    return res.status(200).json(workspace);
  } catch (err) {
    return sendRuntimeApiError(res, err);
  }
};

export default handler;
