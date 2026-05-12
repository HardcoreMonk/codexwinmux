#!/usr/bin/env tsx
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import type { ILayoutData, IWorkspacesData } from '@/types/terminal';
import {
  captureRuntimeEnvAliases,
  restoreRuntimeEnvSnapshot,
  writeRuntimeEnvAlias,
} from './runtime-env-alias';

const RUNTIME_ENV_KEYS = [
  'CODEXMUX_RUNTIME_V2',
  'CODEXMUX_RUNTIME_STORAGE_V2_MODE',
  'CODEXMUX_RUNTIME_DB',
  'CODEXMUX_RUNTIME_V2_STORAGE_MIRROR_DATA_DIR',
];

const main = async (): Promise<void> => {
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codexmux-runtime-v2-storage-write-'));
  const originalEnv = {
    HOME: process.env.HOME,
    ...captureRuntimeEnvAliases(process.env, RUNTIME_ENV_KEYS),
  };

  try {
    const dataDir = path.join(homeDir, '.codexwinmux');
    const layoutDir = path.join(dataDir, 'workspaces', 'ws-write');
    const layoutPath = path.join(layoutDir, 'layout.json');
    const dbPath = path.join(dataDir, 'runtime-v2', 'state.db');
    const workspacesData: IWorkspacesData = {
      workspaces: [{
        id: 'ws-write',
        name: 'Write Smoke',
        directories: [homeDir],
        groupId: 'grp-write',
      }],
      groups: [{ id: 'grp-write', name: 'Write Group', collapsed: false }],
      activeWorkspaceId: 'ws-write',
      sidebarCollapsed: false,
      sidebarWidth: 240,
      updatedAt: new Date().toISOString(),
    };
    const layout: ILayoutData = {
      root: {
        type: 'pane',
        id: 'pane-write',
        activeTabId: 'tab-write',
        tabs: [{
          id: 'tab-write',
          sessionName: 'pt-ws-write-pane-write-tab-write',
          name: '',
          order: 0,
          runtimeVersion: 1,
          cwd: homeDir,
          cliState: 'busy',
          agentSessionId: 'agent-write',
        }],
      },
      activePaneId: 'pane-write',
      updatedAt: new Date().toISOString(),
    };

    await fs.mkdir(layoutDir, { recursive: true });
    await fs.writeFile(path.join(dataDir, 'workspaces.json'), JSON.stringify(workspacesData), { mode: 0o600 });
    process.env.HOME = homeDir;
    writeRuntimeEnvAlias(process.env, 'CODEXMUX_RUNTIME_V2', '1');
    writeRuntimeEnvAlias(process.env, 'CODEXMUX_RUNTIME_STORAGE_V2_MODE', 'write');
    writeRuntimeEnvAlias(process.env, 'CODEXMUX_RUNTIME_DB', dbPath);
    writeRuntimeEnvAlias(process.env, 'CODEXMUX_RUNTIME_V2_STORAGE_MIRROR_DATA_DIR', dataDir);

    const { writeLayoutFile } = await import('@/lib/layout-store');
    const { openRuntimeDatabase } = await import('@/lib/runtime/storage/schema');
    const { createStorageRepository } = await import('@/lib/runtime/storage/repository');
    await writeLayoutFile(layout, layoutPath);

    const db = openRuntimeDatabase(dbPath);
    try {
      const projection = createStorageRepository(db).getWorkspaceLayout('ws-write');
      if (!projection || projection.activePaneId !== 'pane-write' || projection.root.type !== 'pane') {
        throw new Error('runtime v2 storage write mirror did not import workspace layout');
      }
      const tab = projection.root.tabs.find((candidate) => candidate.id === 'tab-write');
      if (!tab || tab.runtimeVersion !== 1 || tab.cliState !== 'busy' || tab.agentSessionId !== 'agent-write') {
        throw new Error('runtime v2 storage write mirror did not preserve tab metadata');
      }
    } finally {
      db.close();
    }

    console.log(JSON.stringify({
      ok: true,
      homeDir,
      checks: ['legacy-layout-write', 'sqlite-import-mirror', 'status-metadata-preserved'],
    }, null, 2));
  } finally {
    restoreRuntimeEnvSnapshot(process.env, originalEnv);
    await fs.rm(homeDir, { recursive: true, force: true });
  }
};

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
