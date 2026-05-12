#!/usr/bin/env tsx
import os from 'os';
import path from 'path';
import { readLegacyStorageSnapshot } from '@/lib/runtime/storage-json-snapshot';
import { importLegacyStorageSnapshot } from '@/lib/runtime/storage-import';
import { openRuntimeDatabase } from '@/lib/runtime/storage/schema';
import { readRuntimeEnvAlias } from './runtime-env-alias';

const main = async (): Promise<void> => {
  const dataDir = readRuntimeEnvAlias(process.env, 'CODEXMUX_RUNTIME_V2_STORAGE_IMPORT_DATA_DIR')
    || path.join(os.homedir(), '.codexwinmux');
  const dbPath = readRuntimeEnvAlias(process.env, 'CODEXMUX_RUNTIME_V2_STORAGE_IMPORT_DB')
    || path.join(dataDir, 'runtime-v2', 'state.db');
  const snapshot = await readLegacyStorageSnapshot(dataDir);
  const db = openRuntimeDatabase(dbPath);
  try {
    const result = importLegacyStorageSnapshot(db, snapshot);
    console.log(JSON.stringify({ ok: true, dbPath, result }, null, 2));
  } finally {
    db.close();
  }
};

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
