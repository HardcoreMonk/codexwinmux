#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = process.env.PORT || '8121';
const healthUrl = `http://127.0.0.1:${port}/api/health`;

const readGit = (args) => {
  try {
    return execFileSync('git', args, {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
};

const run = (cmd, args, options = {}) => {
  console.log(`[deploy-local] ${cmd} ${args.join(' ')}`);
  const result = spawnSync(cmd, args, {
    cwd: rootDir,
    stdio: 'inherit',
    env: options.env ? { ...process.env, ...options.env } : process.env,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

const waitForHealth = async () => {
  const deadline = Date.now() + 15_000;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(healthUrl, { signal: AbortSignal.timeout(2500) });
      if (res.ok) {
        return await res.json();
      }
      lastError = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw lastError instanceof Error ? lastError : new Error('health check timed out');
};

const buildEnv = {
  NEXT_PUBLIC_COMMIT_HASH: process.env.NEXT_PUBLIC_COMMIT_HASH || readGit(['rev-parse', '--short', 'HEAD']) || '',
  NEXT_PUBLIC_BUILD_TIME: process.env.NEXT_PUBLIC_BUILD_TIME || new Date().toISOString(),
};

run('corepack', ['pnpm', 'build'], { env: buildEnv });
run('systemctl', ['--user', 'restart', 'codexmux.service']);

const health = await waitForHealth();
console.log(`[deploy-local] healthy ${JSON.stringify(health)}`);
