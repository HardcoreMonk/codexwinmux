#!/usr/bin/env node
import fs from 'fs/promises';
import net from 'net';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { preferredCodexwinmuxEnvKey, readEnvAlias } from './env-alias-lib.mjs';

const rootDir = process.cwd();
const targetScript = path.join(rootDir, 'scripts', 'smoke-runtime-v2.mjs');
const DEFAULT_TIMEOUT_MS = Number(readEnvAlias(process.env, 'CODEXMUX_RUNTIME_V2_SMOKE_TIMEOUT_MS') || 30_000);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getFreePort = () =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });

const waitFor = async (label, fn, timeoutMs = DEFAULT_TIMEOUT_MS) => {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const result = await fn();
      if (result) return result;
    } catch (err) {
      lastError = err;
    }
    await sleep(150);
  }
  throw new Error(`${label} timed out${lastError instanceof Error ? `: ${lastError.message}` : ''}`);
};

const waitForCliToken = (homeDir) =>
  waitFor('runtime v2 smoke cli token', async () => {
    const raw = await fs.readFile(path.join(homeDir, '.codexwinmux', 'cli-token'), 'utf-8').catch(() => '');
    return raw.trim() || null;
  });

const buildEnvAlias = (legacyKey, value) => ({
  [preferredCodexwinmuxEnvKey(legacyKey)]: value,
  [legacyKey]: value,
});

const runTargetSmoke = ({ baseUrl, homeDir, token }) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [targetScript], {
      cwd: rootDir,
      env: {
        ...process.env,
        HOME: homeDir || process.env.HOME || os.homedir(),
        ...buildEnvAlias('CODEXMUX_RUNTIME_V2_SMOKE_URL', baseUrl),
        ...(token ? { CODEXMUX_TOKEN: token } : {}),
      },
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`runtime v2 target smoke exited with ${signal ?? code}`));
    });
  });

const startServer = async ({ homeDir, dbPath, port }) => {
  const env = {
    ...process.env,
    HOME: homeDir,
    NEXT_TELEMETRY_DISABLED: '1',
    SHELL: '/bin/sh',
    ...buildEnvAlias('CODEXMUX_RUNTIME_V2', '1'),
    ...buildEnvAlias('CODEXMUX_RUNTIME_STORAGE_V2_MODE', 'off'),
    ...buildEnvAlias('CODEXMUX_RUNTIME_TERMINAL_V2_MODE', 'off'),
    ...buildEnvAlias('CODEXMUX_RUNTIME_TIMELINE_V2_MODE', 'off'),
    ...buildEnvAlias('CODEXMUX_RUNTIME_STATUS_V2_MODE', 'off'),
    ...buildEnvAlias('CODEXMUX_RUNTIME_DB', dbPath),
    PORT: String(port),
  };
  delete env.__CMUX_PRISTINE_ENV;
  env.__CMUX_PRISTINE_ENV = JSON.stringify(env);

  const child = spawn('corepack', ['pnpm', 'exec', 'tsx', 'server.ts'], {
    cwd: rootDir,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    output += chunk.toString();
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitFor('runtime v2 isolated server startup', async () => {
    if (child.exitCode !== null) {
      throw new Error(`server exited early with ${child.exitCode}: ${output.slice(-1600)}`);
    }
    const res = await fetch(new URL('/api/health', baseUrl)).catch(() => null);
    return res?.ok;
  });

  const token = await waitForCliToken(homeDir);

  return {
    baseUrl,
    token,
    getOutput: () => output,
    stop: async () => {
      if (child.exitCode !== null) return;
      child.kill('SIGINT');
      await Promise.race([
        new Promise((resolve) => child.once('exit', resolve)),
        sleep(10_000).then(() => {
          if (child.exitCode === null) child.kill('SIGTERM');
          return new Promise((resolve) => child.once('exit', resolve));
        }),
      ]);
    },
  };
};

const main = async () => {
  const targetUrl = readEnvAlias(process.env, 'CODEXMUX_RUNTIME_V2_SMOKE_URL')?.trim();
  if (targetUrl) {
    await runTargetSmoke({ baseUrl: targetUrl });
    return;
  }

  const homeDir = readEnvAlias(process.env, 'CODEXMUX_RUNTIME_V2_SMOKE_HOME')
    || await fs.mkdtemp(path.join(os.tmpdir(), 'codexmux-runtime-v2-smoke-'));
  const dbPath = readEnvAlias(process.env, 'CODEXMUX_RUNTIME_DB') || path.join(homeDir, 'runtime-v2', 'state.db');
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  const port = Number(readEnvAlias(process.env, 'CODEXMUX_RUNTIME_V2_SMOKE_PORT') || await getFreePort());
  let server = null;

  try {
    server = await startServer({ homeDir, dbPath, port });
    await runTargetSmoke({ baseUrl: server.baseUrl, homeDir, token: server.token });
  } catch (err) {
    if (server) console.error(server.getOutput().slice(-4000));
    throw err;
  } finally {
    if (server) await server.stop();
  }
};

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : err);
  process.exit(1);
});
