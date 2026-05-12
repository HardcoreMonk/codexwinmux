import type { NextApiRequest, NextApiResponse } from 'next';
import { markDeviceVisible, markDeviceHidden } from '@/lib/push-subscriptions';
import { isRuntimeV2Enabled } from '@/lib/runtime/env';
import { getRuntimeStatusV2Mode } from '@/lib/runtime/status-mode';
import { getRuntimeSupervisor } from '@/lib/runtime/supervisor';

const shouldUseRuntimeStatusLive = (): boolean =>
  isRuntimeV2Enabled() && getRuntimeStatusV2Mode() === 'default';

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { deviceId, visible } = req.body ?? {};
  if (!deviceId || typeof visible !== 'boolean') {
    return res.status(400).json({ error: 'Invalid body' });
  }

  if (visible) {
    markDeviceVisible(deviceId);
  } else {
    markDeviceHidden(deviceId);
  }
  if (shouldUseRuntimeStatusLive()) {
    getRuntimeSupervisor().updateStatusLiveDeviceVisibility({ deviceId, visible }).catch(() => {});
  }

  return res.status(200).json({ ok: true });
};

export default handler;
