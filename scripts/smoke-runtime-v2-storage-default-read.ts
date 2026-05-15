#!/usr/bin/env tsx
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { importLegacyStorageSnapshot } from '@/lib/runtime/storage-import';
import { openRuntimeDatabase } from '@/lib/runtime/storage/schema';
import type { ILayoutData, IWorkspacesData } from '@/types/terminal';
import {
  captureRuntimeEnvAliases,
  restoreRuntimeEnvSnapshot,
  writeRuntimeEnvAlias,
} from './runtime-env-alias';

const RUNTIME_ENV_KEYS = [
  'CODEXWINMUX_RUNTIME_V2',
  'CODEXWINMUX_RUNTIME_STORAGE_V2_MODE',
  'CODEXWINMUX_RUNTIME_DB',
  'CODEXWINMUX_RUNTIME_V2_STORAGE_MIRROR_DATA_DIR',
];

const assert = (condition: unknown, message: string): void => {
  if (!condition) throw new Error(message);
};

const main = async (): Promise<void> => {
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codexmux-runtime-v2-storage-default-'));
  const originalEnv = {
    HOME: process.env.HOME,
    ...captureRuntimeEnvAliases(process.env, RUNTIME_ENV_KEYS),
  };

  try {
    const dataDir = path.join(homeDir, '.codexwinmux');
    const layoutDir = path.join(dataDir, 'workspaces', 'ws-default');
    const layoutPath = path.join(layoutDir, 'layout.json');
    const messageHistoryPath = path.join(layoutDir, 'message-history.json');
    const dbPath = path.join(dataDir, 'runtime-v2', 'state.db');
    const importedAt = '2026-05-04T00:00:00.000Z';
    const workspacesData: IWorkspacesData = {
      workspaces: [{
        id: 'ws-default',
        name: 'Default Read',
        directories: [homeDir, path.join(homeDir, 'nested')],
        groupId: 'grp-default',
      }],
      groups: [{ id: 'grp-default', name: 'Default Group', collapsed: true }],
      activeWorkspaceId: 'ws-default',
      sidebarCollapsed: true,
      sidebarWidth: 308,
      updatedAt: importedAt,
    };
    const layout: ILayoutData = {
      root: {
        type: 'pane',
        id: 'pane-default',
        activeTabId: 'tab-default',
        tabs: [{
          id: 'tab-default',
          sessionName: 'pt-ws-default-pane-default-tab-default',
          name: 'Default tab',
          order: 0,
          runtimeVersion: 1,
          cwd: homeDir,
          cliState: 'busy',
          agentSessionId: 'agent-default',
        }],
      },
      activePaneId: 'pane-default',
      updatedAt: importedAt,
    };

    await fs.mkdir(layoutDir, { recursive: true });
    await fs.writeFile(path.join(dataDir, 'workspaces.json'), JSON.stringify(workspacesData), { mode: 0o600 });
    await fs.writeFile(layoutPath, JSON.stringify(layout), { mode: 0o600 });

    const db = openRuntimeDatabase(dbPath);
    try {
      importLegacyStorageSnapshot(db, {
        workspacesData,
        layoutsByWorkspaceId: { 'ws-default': layout },
        messageHistoryByWorkspaceId: {
          'ws-default': [{ id: 'hist-default', message: 'imported history', sentAt: importedAt }],
        },
        importedAt,
      });
    } finally {
      db.close();
    }

    process.env.HOME = homeDir;
    writeRuntimeEnvAlias(process.env, 'CODEXWINMUX_RUNTIME_V2', '1');
    writeRuntimeEnvAlias(process.env, 'CODEXWINMUX_RUNTIME_STORAGE_V2_MODE', 'default');
    writeRuntimeEnvAlias(process.env, 'CODEXWINMUX_RUNTIME_DB', dbPath);
    writeRuntimeEnvAlias(process.env, 'CODEXWINMUX_RUNTIME_V2_STORAGE_MIRROR_DATA_DIR', dataDir);

    await fs.rm(path.join(dataDir, 'workspaces.json'), { force: true });
    await fs.rm(layoutPath, { force: true });
    await fs.rm(messageHistoryPath, { force: true });

    const { getWorkspaces, initWorkspaceStore, updateActive } = await import('@/lib/workspace-store');
    const { readLayoutFile, writeLayoutFile } = await import('@/lib/layout-store');
    const { readMessageHistory, addMessageHistory, deleteMessageHistory } = await import('@/lib/message-history-store');

    await initWorkspaceStore();
    const initialWorkspaces = await getWorkspaces();
    assert(initialWorkspaces.workspaces[0]?.id === 'ws-default', 'default read did not use SQLite workspace snapshot');
    assert(initialWorkspaces.workspaces[0]?.directories.length === 2, 'default read did not preserve workspace directories');
    assert(initialWorkspaces.groups[0]?.collapsed === true, 'default read did not preserve group metadata');
    assert(initialWorkspaces.sidebarCollapsed === true && initialWorkspaces.sidebarWidth === 308, 'default read did not preserve sidebar metadata');

    const initialLayout = await readLayoutFile(layoutPath);
    assert(initialLayout?.root.type === 'pane', 'default read did not use SQLite layout snapshot');
    if (initialLayout?.root.type === 'pane') {
      assert(initialLayout.root.tabs[0]?.agentSessionId === 'agent-default', 'default read did not preserve tab status metadata');
    }

    const importedHistory = await readMessageHistory('ws-default');
    assert(importedHistory[0]?.message === 'imported history', 'default read did not use SQLite message history snapshot');

    await fs.mkdir(layoutDir, { recursive: true });
    await fs.writeFile(path.join(dataDir, 'workspaces.json'), JSON.stringify(workspacesData), { mode: 0o600 });
    await fs.writeFile(layoutPath, JSON.stringify(layout), { mode: 0o600 });

    const baseTab = layout.root.type === 'pane' ? layout.root.tabs[0] : null;
    if (!baseTab) {
      throw new Error('storage default read smoke fixture missing base tab');
    }

    const updatedLayout: ILayoutData = {
      ...layout,
      root: {
        type: 'pane',
        id: 'pane-default',
        activeTabId: 'tab-default',
        tabs: [{
          ...baseTab,
          name: 'Updated from JSON write',
          lastUserMessage: 'mirror evidence',
        }],
      },
      updatedAt: '2026-05-04T00:01:00.000Z',
    };
    await writeLayoutFile(updatedLayout, layoutPath);
    const mirroredLayout = await readLayoutFile(layoutPath);
    assert(mirroredLayout?.root.type === 'pane', 'mirrored default read layout was not a pane');
    if (mirroredLayout?.root.type === 'pane') {
      assert(mirroredLayout.root.tabs[0]?.name === 'Updated from JSON write', 'default read did not reflect mirrored layout write');
      assert(mirroredLayout.root.tabs[0]?.lastUserMessage === 'mirror evidence', 'default read did not reflect mirrored tab metadata');
    }

    await updateActive({ sidebarCollapsed: false, sidebarWidth: 260 });
    const updatedWorkspaces = await getWorkspaces();
    assert(updatedWorkspaces.sidebarCollapsed === false && updatedWorkspaces.sidebarWidth === 260, 'default read did not reflect mirrored workspace UI state');

    const addedHistory = await addMessageHistory('ws-default', 'runtime history');
    const updatedHistory = await readMessageHistory('ws-default');
    assert(updatedHistory[0]?.id === addedHistory.id, 'default write did not update SQLite message history');
    writeRuntimeEnvAlias(process.env, 'CODEXWINMUX_RUNTIME_STORAGE_V2_MODE', 'off');
    const rollbackHistory = await readMessageHistory('ws-default');
    assert(rollbackHistory[0]?.id === addedHistory.id, 'default write did not mirror message history rollback JSON');
    writeRuntimeEnvAlias(process.env, 'CODEXWINMUX_RUNTIME_STORAGE_V2_MODE', 'default');
    await deleteMessageHistory('ws-default', addedHistory.id);
    const deletedHistory = await readMessageHistory('ws-default');
    assert(deletedHistory.every((entry) => entry.id !== addedHistory.id), 'default delete did not update SQLite message history');

    console.log(JSON.stringify({
      ok: true,
      homeDir,
      checks: [
        'sqlite-workspace-default-read',
        'sqlite-layout-default-read',
        'sqlite-only-cold-start-no-json-prune',
        'workspace-directories-preserved',
        'sidebar-state-preserved',
        'legacy-layout-write-mirror-default-read',
        'legacy-workspace-ui-write-mirror-default-read',
        'message-history-default-read',
        'message-history-json-rollback-mirror',
      ],
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
