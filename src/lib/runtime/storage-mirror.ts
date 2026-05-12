import os from 'os';
import path from 'path';
import { createLogger } from '@/lib/logger';
import { readRuntimeDbPathEnv, readRuntimeStorageMirrorDataDirEnv } from '@/lib/runtime/env';
import { shouldMirrorLegacyStorageToRuntimeV2 } from '@/lib/runtime/storage-mode';
import { readLegacyStorageSnapshot } from '@/lib/runtime/storage-json-snapshot';
import { importLegacyStorageSnapshot, type IImportLegacyStorageSnapshotResult } from '@/lib/runtime/storage-import';
import { openRuntimeDatabase } from '@/lib/runtime/storage/schema';

export interface IRuntimeStorageMirrorInput {
  reason: string;
  dataDir?: string;
  dbPath?: string;
  importedAt?: string;
}

export interface IRuntimeStorageMirrorResult {
  mirrored: boolean;
  reason: string;
  result?: IImportLegacyStorageSnapshotResult;
}

const log = createLogger('runtime-storage');

const g = globalThis as unknown as {
  __ptRuntimeStorageMirrorLock?: Promise<void>;
};
if (!g.__ptRuntimeStorageMirrorLock) g.__ptRuntimeStorageMirrorLock = Promise.resolve();

const withMirrorLock = async <T>(fn: () => Promise<T>): Promise<T> => {
  let release: () => void;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  const previous = g.__ptRuntimeStorageMirrorLock!;
  g.__ptRuntimeStorageMirrorLock = next;
  await previous;
  try {
    return await fn();
  } finally {
    release!();
  }
};

const getDefaultDataDir = (): string =>
  readRuntimeStorageMirrorDataDirEnv()
  || path.join(os.homedir(), '.codexwinmux');

const getDefaultDbPath = (dataDir: string): string =>
  readRuntimeDbPathEnv()
  || path.join(dataDir, 'runtime-v2', 'state.db');

export const mirrorLegacyStorageToRuntimeV2 = async ({
  reason,
  dataDir = getDefaultDataDir(),
  dbPath = getDefaultDbPath(dataDir),
  importedAt = new Date().toISOString(),
}: IRuntimeStorageMirrorInput): Promise<IRuntimeStorageMirrorResult> => {
  if (!shouldMirrorLegacyStorageToRuntimeV2()) {
    return { mirrored: false, reason };
  }

  return withMirrorLock(async () => {
    const snapshot = await readLegacyStorageSnapshot(dataDir);
    const db = openRuntimeDatabase(dbPath);
    try {
      const result = importLegacyStorageSnapshot(db, { ...snapshot, importedAt, pruneMissing: true });
      return { mirrored: true, reason, result };
    } finally {
      db.close();
    }
  });
};

export const mirrorLegacyStorageToRuntimeV2BestEffort = async (
  input: IRuntimeStorageMirrorInput,
): Promise<IRuntimeStorageMirrorResult | null> => {
  try {
    return await mirrorLegacyStorageToRuntimeV2(input);
  } catch (err) {
    log.warn(`runtime v2 storage mirror failed after ${input.reason}: ${err instanceof Error ? err.message : err}`);
    return null;
  }
};
