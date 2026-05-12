import type { NextApiRequest, NextApiResponse } from 'next';
import { isAllowedJsonlPath } from '@/lib/path-validation';
import { verifyRuntimeV2ApiAuth } from '@/lib/runtime/api-auth';
import { sendRuntimeApiError, sendRuntimeDisabled } from '@/lib/runtime/api-handler';
import { isRuntimeV2Enabled } from '@/lib/runtime/env';
import { getRuntimeSupervisor } from '@/lib/runtime/supervisor';

const DEFAULT_LIMIT = 64;
const MAX_LIMIT = 200;

const firstQueryValue = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

const parseLimit = (value: string | undefined): number => {
  const parsed = value ? Number.parseInt(value, 10) : Number.NaN;
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, parsed));
};

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  if (!isRuntimeV2Enabled()) {
    return sendRuntimeDisabled(res);
  }

  if (!(await verifyRuntimeV2ApiAuth(req))) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const jsonlPath = firstQueryValue(req.query.jsonlPath);
  if (!jsonlPath) {
    return res.status(400).json({ error: 'jsonlPath parameter required' });
  }

  if (!isAllowedJsonlPath(jsonlPath)) {
    return res.status(403).json({ error: 'Path not allowed' });
  }

  const beforeByte = Number.parseInt(firstQueryValue(req.query.beforeByte) ?? '', 10);
  if (Number.isNaN(beforeByte) || beforeByte < 0) {
    return res.status(400).json({ error: 'beforeByte parameter required' });
  }

  try {
    const supervisor = getRuntimeSupervisor();
    const result = await supervisor.readTimelineEntriesBefore({
      jsonlPath,
      beforeByte,
      limit: parseLimit(firstQueryValue(req.query.limit)),
      panelType: firstQueryValue(req.query.panelType) ?? 'codex',
    });
    return res.status(200).json(result);
  } catch (err) {
    return sendRuntimeApiError(res, err);
  }
};

export default handler;
