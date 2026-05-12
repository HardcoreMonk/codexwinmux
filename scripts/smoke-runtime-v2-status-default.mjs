#!/usr/bin/env node
import { spawn } from 'child_process';
import { buildEnvAlias } from './env-alias-lib.mjs';

const child = spawn('node', ['scripts/smoke-permission-prompt.mjs'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    ...buildEnvAlias('CODEXMUX_RUNTIME_V2', '1'),
    ...buildEnvAlias('CODEXMUX_RUNTIME_STATUS_V2_MODE', 'default'),
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
