#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAndroidGradleInvocation } from './android-gradle-lib.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const invocation = buildAndroidGradleInvocation({
  rootDir,
  args: process.argv.slice(2),
});

const result = spawnSync(invocation.command, invocation.args, {
  cwd: invocation.cwd,
  env: invocation.env,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

process.exit(result.status ?? 1);
