#!/usr/bin/env tsx
import os from 'os';
import path from 'path';
import { createRuntimeStorageBackup } from '@/lib/runtime/storage-backup';
import { readRuntimeEnvAlias } from './runtime-env-alias';

const main = async (): Promise<void> => {
  const dataDir = readRuntimeEnvAlias(process.env, 'CODEXMUX_RUNTIME_V2_STORAGE_BACKUP_DATA_DIR')
    || path.join(os.homedir(), '.codexwinmux');
  const outputRoot = readRuntimeEnvAlias(process.env, 'CODEXMUX_RUNTIME_V2_STORAGE_BACKUP_OUTPUT_DIR')
    || path.join(dataDir, 'backups');
  const timestamp = readRuntimeEnvAlias(process.env, 'CODEXMUX_RUNTIME_V2_STORAGE_BACKUP_TIMESTAMP');
  const result = await createRuntimeStorageBackup({ dataDir, outputRoot, timestamp });
  console.log(JSON.stringify({
    ok: true,
    backupDir: result.backupDir,
    copiedCount: result.copied.length,
    copied: result.copied,
  }, null, 2));
};

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
