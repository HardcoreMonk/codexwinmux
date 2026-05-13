#!/usr/bin/env node
import { spawn } from 'child_process';
import { buildEnvAlias, stripLegacyRuntimeEnv } from './env-alias-lib.mjs';

const child = spawn('node', ['scripts/smoke-permission-prompt.mjs'], {
  cwd: process.cwd(),
  env: {
    ...stripLegacyRuntimeEnv(process.env),
    ...buildEnvAlias('CODEXWINMUX_RUNTIME_V2', '1'),
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
