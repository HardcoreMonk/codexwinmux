#!/usr/bin/env tsx
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { analyzeRuntimeStorageDryRun } from '@/lib/runtime/storage-dry-run';
import type { ILayoutData, IWorkspacesData } from '@/types/terminal';

const createEmptyWorkspacesData = (): IWorkspacesData => ({
  workspaces: [],
  groups: [],
  sidebarCollapsed: false,
  sidebarWidth: 240,
  updatedAt: new Date().toISOString(),
});

const readJsonIfPresent = async (filePath: string): Promise<unknown | null> => {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf-8')) as unknown;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    if (err instanceof SyntaxError) {
      return { root: { type: 'invalid-json' } };
    }
    throw err;
  }
};

const readWorkspacesData = async (dataDir: string): Promise<IWorkspacesData> => {
  const workspacesFile = path.join(dataDir, 'workspaces.json');
  const raw = await readJsonIfPresent(workspacesFile);
  if (!raw) return createEmptyWorkspacesData();
  if (typeof raw === 'object' && raw && Array.isArray((raw as IWorkspacesData).workspaces)) {
    const data = raw as IWorkspacesData;
    return {
      ...data,
      groups: Array.isArray(data.groups) ? data.groups : [],
      sidebarCollapsed: Boolean(data.sidebarCollapsed),
      sidebarWidth: typeof data.sidebarWidth === 'number' ? data.sidebarWidth : 240,
      updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : new Date().toISOString(),
    };
  }
  throw new Error('workspaces.json is present but not a valid workspace list');
};

const readLayouts = async (
  dataDir: string,
  workspacesData: IWorkspacesData,
): Promise<Record<string, ILayoutData | null | undefined>> => {
  const entries = await Promise.all(workspacesData.workspaces.map(async (workspace) => {
    const layoutPath = path.join(dataDir, 'workspaces', workspace.id, 'layout.json');
    const raw = await readJsonIfPresent(layoutPath);
    return [workspace.id, raw as ILayoutData | null | undefined] as const;
  }));
  return Object.fromEntries(entries);
};

const main = async (): Promise<void> => {
  const dataDir = process.env.CODEXMUX_RUNTIME_V2_STORAGE_DRY_RUN_DATA_DIR
    || path.join(os.homedir(), '.codexwinmux');
  const workspacesData = await readWorkspacesData(dataDir);
  const layoutsByWorkspaceId = await readLayouts(dataDir, workspacesData);
  const report = analyzeRuntimeStorageDryRun({ workspacesData, layoutsByWorkspaceId });
  console.log(JSON.stringify(report, null, 2));
};

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
