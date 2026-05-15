import os from 'os';
import path from 'path';
import { createLogger } from '@/lib/logger';
import {
  isRuntimeV2Enabled,
  readRuntimeDbPathEnv,
  readRuntimeEnvAlias,
  readRuntimeStorageMirrorDataDirEnv,
} from '@/lib/runtime/env';
import { resolveRuntimeStorageV2Mode } from '@/lib/runtime/storage-mode';
import { createStorageRepository } from '@/lib/runtime/storage/repository';
import { openRuntimeDatabase } from '@/lib/runtime/storage/schema';
import type { IRuntimeTabStatusMetadataPatchInput, IRuntimeTabStatusMetadataResult } from '@/lib/runtime/contracts';
import type { IHistoryEntry } from '@/types/message-history';
import type { ILayoutData, IWorkspacesData } from '@/types/terminal';

export interface IRuntimeStorageReadOwnerOptions {
  runtimeV2Enabled?: boolean;
  storageMode?: unknown;
}

const log = createLogger('runtime-storage');

export class RuntimeStorageUnavailableError extends Error {
  readonly code = 'runtime-storage-unavailable';
  readonly retryable = true;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'RuntimeStorageUnavailableError';
    if (cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = cause;
    }
  }
}

const describeRuntimeStorageCause = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

const runtimeStorageUnavailable = (message: string, cause?: unknown): RuntimeStorageUnavailableError =>
  new RuntimeStorageUnavailableError(
    cause === undefined ? message : `${message}: ${describeRuntimeStorageCause(cause)}`,
    cause,
  );

const getDefaultDataDir = (): string =>
  readRuntimeStorageMirrorDataDirEnv()
  || path.join(os.homedir(), '.codexwinmux');

const getDefaultDbPath = (dataDir = getDefaultDataDir()): string =>
  readRuntimeDbPathEnv()
  || path.join(dataDir, 'runtime-v2', 'state.db');

export const shouldReadRuntimeStorageV2 = ({
  runtimeV2Enabled = isRuntimeV2Enabled(),
  storageMode = readRuntimeEnvAlias(process.env, 'CODEXWINMUX_RUNTIME_STORAGE_V2_MODE'),
}: IRuntimeStorageReadOwnerOptions = {}): boolean =>
  runtimeV2Enabled && resolveRuntimeStorageV2Mode({ runtimeV2Enabled, storageMode }) === 'default';

export const readRuntimeStorageWorkspaces = (): IWorkspacesData | null => {
  if (!shouldReadRuntimeStorageV2()) return null;

  let db: ReturnType<typeof openRuntimeDatabase> | null = null;
  try {
    db = openRuntimeDatabase(getDefaultDbPath());
    const snapshot = createStorageRepository(db).getWorkspaceSnapshot();
    return snapshot;
  } catch (err) {
    const failure = runtimeStorageUnavailable('runtime v2 workspace read failed', err);
    log.warn(failure.message);
    throw failure;
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
    const failure = runtimeStorageUnavailable('runtime v2 workspace UI state write failed', err);
    log.warn(failure.message);
    throw failure;
  } finally {
    db?.close();
  }
};

export const replaceRuntimeWorkspaceDirectories = (
  workspaceId: string,
  directories: readonly string[],
): boolean => {
  if (!shouldReadRuntimeStorageV2()) return false;

  let db: ReturnType<typeof openRuntimeDatabase> | null = null;
  try {
    db = openRuntimeDatabase(getDefaultDbPath());
    const repo = createStorageRepository(db);
    if (!repo.hasWorkspace(workspaceId)) {
      throw runtimeStorageUnavailable(`runtime v2 workspace not found: ${workspaceId}`);
    }
    repo.replaceWorkspaceDirectories(workspaceId, directories);
    return true;
  } catch (err) {
    const failure = err instanceof RuntimeStorageUnavailableError
      ? err
      : runtimeStorageUnavailable('runtime v2 workspace directory write failed', err);
    log.warn(failure.message);
    throw failure;
  } finally {
    db?.close();
  }
};

export const readRuntimeStorageLayout = (workspaceId: string): ILayoutData | null => {
  if (!shouldReadRuntimeStorageV2()) return null;

  let db: ReturnType<typeof openRuntimeDatabase> | null = null;
  try {
    db = openRuntimeDatabase(getDefaultDbPath());
    const layout = createStorageRepository(db).getWorkspaceLayout(workspaceId);
    if (!layout) {
      throw runtimeStorageUnavailable(`runtime v2 layout not found: ${workspaceId}`);
    }
    return layout;
  } catch (err) {
    const failure = err instanceof RuntimeStorageUnavailableError
      ? err
      : runtimeStorageUnavailable('runtime v2 layout read failed', err);
    log.warn(failure.message);
    throw failure;
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
    if (!repo.hasWorkspace(workspaceId)) {
      throw runtimeStorageUnavailable(`runtime v2 message history workspace not found: ${workspaceId}`);
    }
    return repo.listMessageHistory(workspaceId);
  } catch (err) {
    const failure = err instanceof RuntimeStorageUnavailableError
      ? err
      : runtimeStorageUnavailable('runtime v2 message history read failed', err);
    log.warn(failure.message);
    throw failure;
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
    if (!repo.hasWorkspace(workspaceId)) {
      throw runtimeStorageUnavailable(`runtime v2 message history workspace not found: ${workspaceId}`);
    }
    repo.replaceMessageHistory(workspaceId, entries);
    return true;
  } catch (err) {
    const failure = err instanceof RuntimeStorageUnavailableError
      ? err
      : runtimeStorageUnavailable('runtime v2 message history write failed', err);
    log.warn(failure.message);
    throw failure;
  } finally {
    db?.close();
  }
};

export const patchRuntimeTabStatusMetadata = (
  input: IRuntimeTabStatusMetadataPatchInput,
): IRuntimeTabStatusMetadataResult | null => {
  if (!shouldReadRuntimeStorageV2()) return null;

  let db: ReturnType<typeof openRuntimeDatabase> | null = null;
  try {
    db = openRuntimeDatabase(getDefaultDbPath());
    return createStorageRepository(db).patchTabStatusMetadata(input);
  } catch (err) {
    const failure = runtimeStorageUnavailable('runtime v2 tab status metadata write failed', err);
    log.warn(failure.message);
    throw failure;
  } finally {
    db?.close();
  }
};
