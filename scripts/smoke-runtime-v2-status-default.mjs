#!/usr/bin/env node
import { spawn } from 'child_process';
import { buildEnvAlias, stripLegacyRuntimeEnv } from './env-alias-lib.mjs';

const script = process.platform === 'win32'
  ? 'scripts/smoke-runtime-v2-status-default-windows.mjs'
  : 'scripts/smoke-permission-prompt.mjs';

const child = spawn('node', [script], {
  cwd: process.cwd(),
  env: {
    ...stripLegacyRuntimeEnv(process.env),
    ...buildEnvAlias('CODEXWINMUX_RUNTIME_V2', '1'),
    ...(process.platform === 'win32' ? {
      ...buildEnvAlias('CODEXWINMUX_RUNTIME_STORAGE_V2_MODE', 'default'),
      ...buildEnvAlias('CODEXWINMUX_RUNTIME_TERMINAL_V2_MODE', 'new-tabs'),
    } : {}),
    ...buildEnvAlias('CODEXWINMUX_RUNTIME_STATUS_V2_MODE', 'default'),
    ...(process.platform === 'win32' ? buildEnvAlias('CODEXWINMUX_RUNTIME_TERMINAL_ADAPTER', 'windows') : {}),
    CODEXMUX_PERMISSION_SMOKE_EXPECT_STATUS_MODE: 'default',
  },
  stdio: 'inherit',
});

child.on('error', (err) => {
  console.error(err instanceof Error ? err.stack || err.message : err);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (code === 0) return;
  console.error(`status default smoke exited with ${signal ?? code}`);
  process.exit(code ?? 1);
});
