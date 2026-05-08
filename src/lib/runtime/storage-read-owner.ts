import os from 'os';
import path from 'path';
import { createLogger } from '@/lib/logger';
import { parseRuntimeStorageV2Mode } from '@/lib/runtime/storage-mode';
import { createStorageRepository } from '@/lib/runtime/storage/repository';
import { openRuntimeDatabase } from '@/lib/runtime/storage/schema';
import type { IHistoryEntry } from '@/types/message-history';
import type { ILayoutData, IWorkspacesData } from '@/types/terminal';

export interface IRuntimeStorageReadOwnerOptions {
  runtimeV2Enabled?: boolean;
  storageMode?: unknown;
}

const log = createLogger('runtime-storage');

const getDefaultDataDir = (): string =>
  process.env.CODEXMUX_RUNTIME_V2_STORAGE_MIRROR_DATA_DIR
  || path.join(os.homedir(), '.codexmux');

const getDefaultDbPath = (dataDir = getDefaultDataDir()): string =>
  process.env.CODEXMUX_RUNTIME_DB
  || path.join(dataDir, 'runtime-v2', 'state.db');

export const shouldReadRuntimeStorageV2 = ({
  runtimeV2Enabled = process.env.CODEXMUX_RUNTIME_V2 === '1',
  storageMode = process.env.CODEXMUX_RUNTIME_STORAGE_V2_MODE,
}: IRuntimeStorageReadOwnerOptions = {}): boolean =>
  runtimeV2Enabled && parseRuntimeStorageV2Mode(storageMode) === 'default';

export const readRuntimeStorageWorkspaces = (): IWorkspacesData | null => {
  if (!shouldReadRuntimeStorageV2()) return null;

  let db: ReturnType<typeof openRuntimeDatabase> | null = null;
  try {
    db = openRuntimeDatabase(getDefaultDbPath());
    const snapshot = createStorageRepository(db).getWorkspaceSnapshot();
    return snapshot;
  } catch (err) {
    log.warn(`runtime v2 workspace read failed, falling back to JSON: ${err instanceof Error ? err.message : err}`);
    return null;
  } finally {
    db?.close();
  }
};

export const writeRuntimeWorkspaceUiState = (input: {
  activeWorkspaceId?: string | null;
  sidebarCollapsed?: boolean;
  sidebarWidth?: number;
}): boolean => {
  if (!shouldReadRuntimeStorageV2()) return false;

  let db: ReturnType<typeof openRuntimeDatabase> | null = null;
  try {
    db = openRuntimeDatabase(getDefaultDbPath());
    createStorageRepository(db).setWorkspaceUiState(input);
    return true;
  } catch (err) {
    log.warn(`runtime v2 workspace UI state write failed: ${err instanceof Error ? err.message : err}`);
    return false;
  } finally {
    db?.close();
  }
};

export const readRuntimeStorageLayout = (workspaceId: string): ILayoutData | null => {
  if (!shouldReadRuntimeStorageV2()) return null;

  let db: ReturnType<typeof openRuntimeDatabase> | null = null;
  try {
    db = openRuntimeDatabase(getDefaultDbPath());
    return createStorageRepository(db).getWorkspaceLayout(workspaceId);
  } catch (err) {
    log.warn(`runtime v2 layout read failed, falling back to JSON: ${err instanceof Error ? err.message : err}`);
    return null;
  } finally {
    db?.close();
  }
};

export const readRuntimeMessageHistory = (workspaceId: string): IHistoryEntry[] | null => {
  if (!shouldReadRuntimeStorageV2()) return null;

  let db: ReturnType<typeof openRuntimeDatabase> | null = null;
  try {
    db = openRuntimeDatabase(getDefaultDbPath());
    const repo = createStorageRepository(db);
    if (!repo.hasWorkspace(workspaceId)) return null;
    return repo.listMessageHistory(workspaceId);
  } catch (err) {
    log.warn(`runtime v2 message history read failed, falling back to JSON: ${err instanceof Error ? err.message : err}`);
    return null;
  } finally {
    db?.close();
  }
};

export const replaceRuntimeMessageHistory = (
  workspaceId: string,
  entries: readonly IHistoryEntry[],
): boolean => {
  if (!shouldReadRuntimeStorageV2()) return false;

  let db: ReturnType<typeof openRuntimeDatabase> | null = null;
  try {
    db = openRuntimeDatabase(getDefaultDbPath());
    const repo = createStorageRepository(db);
    if (!repo.hasWorkspace(workspaceId)) return false;
    repo.replaceMessageHistory(workspaceId, entries);
    return true;
  } catch (err) {
    log.warn(`runtime v2 message history write failed: ${err instanceof Error ? err.message : err}`);
    return false;
  } finally {
    db?.close();
  }
};
