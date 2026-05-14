import type { NextApiRequest, NextApiResponse } from 'next';
import {
  readKeybindings,
  setKeybinding,
  resetKeybinding,
  resetAllKeybindings,
} from '@/lib/keybindings-store';
import { ACTIONS } from '@/lib/keyboard-shortcuts';
import { broadcastSync } from '@/lib/sync-server';

const isKnownActionId = (id: string): boolean =>
  Object.prototype.hasOwnProperty.call(ACTIONS, id);

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') {
    const data = await readKeybindings();
    return res.status(200).json(data);
  }

  if (req.method === 'PATCH') {
    const { id, key } = (req.body ?? {}) as {
      id?: unknown;
      key?: unknown;
    };
    if (typeof id !== 'string' || !id || !isKnownActionId(id)) {
      return res.status(400).json({ error: 'unknown action id' });
    }
    if (key !== null && typeof key !== 'string') {
      return res.status(400).json({ error: 'key must be string or null' });
    }
    const data = await setKeybinding(id, key);
    broadcastSync({ type: 'config' });
    return res.status(200).json(data);
  }

  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (typeof id === 'string' && id) {
      if (!isKnownActionId(id)) {
        return res.status(400).json({ error: 'unknown action id' });
      }
      const data = await resetKeybinding(id);
      broadcastSync({ type: 'config' });
      return res.status(200).json(data);
    }
    const data = await resetAllKeybindings();
    broadcastSync({ type: 'config' });
    return res.status(200).json(data);
  }

  res.setHeader('Allow', 'GET, PATCH, DELETE');
  return res.status(405).json({ error: 'Method not allowed' });
};

export default handler;
