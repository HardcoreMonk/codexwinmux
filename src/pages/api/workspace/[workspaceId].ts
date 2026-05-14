import type { NextApiRequest, NextApiResponse } from 'next';
import { deleteWorkspace, renameWorkspace, setWorkspaceGroup } from '@/lib/workspace-store';

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  res.setHeader('Cache-Control', 'no-store');

  const workspaceId = req.query.workspaceId as string;

  if (req.method === 'DELETE') {
    const found = await deleteWorkspace(workspaceId);
    if (!found) {
      return res.status(404).json({ error: 'Workspace not found' });
    }
    return res.status(204).end();
  }

  if (req.method === 'PATCH') {
    const { name, groupId } = req.body ?? {};

    if (groupId !== undefined) {
      const next = groupId === null ? null : typeof groupId === 'string' ? groupId : undefined;
      if (next === undefined) {
        return res.status(400).json({ error: 'Invalid groupId' });
      }
      const ok = await setWorkspaceGroup(workspaceId, next);
      if (!ok) return res.status(404).json({ error: 'Workspace not found' });
      if (name === undefined) return res.status(200).json({ ok: true });
    }

    if (name !== undefined) {
      if (typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ error: 'name field required' });
      }
      const ws = await renameWorkspace(workspaceId, name.trim());
      if (!ws) {
        return res.status(404).json({ error: 'Workspace not found' });
      }
      return res.status(200).json(ws);
    }

    return res.status(400).json({ error: 'name or groupId required' });
  }

  res.setHeader('Allow', 'DELETE, PATCH');
  return res.status(405).json({ error: 'Method not allowed' });
};

export default handler;
