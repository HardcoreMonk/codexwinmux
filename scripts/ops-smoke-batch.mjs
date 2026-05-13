#!/usr/bin/env node
import { spawn } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { buildEnvAlias } from './env-alias-lib.mjs';
import { writeSmokeArtifact } from './smoke-artifact-lib.mjs';

const startedAt = new Date().toISOString();
const artifactRoot = process.env.CODEXMUX_SMOKE_ARTIFACT_DIR
  || path.join(os.tmpdir(), `codexmux-ops-smoke-${Date.now()}`);

const quoteWindowsCmdArg = (value) => {
  const text = String(value);
  if (!/[()\s^&|<>"]/.test(text)) return text;
  return `"${text.replace(/(["^])/g, '^$1')}"`;
};

const buildCorepackInvocation = (args) => (
  process.platform === 'win32'
    ? {
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', ['corepack', 'pnpm', ...args].map(quoteWindowsCmdArg).join(' ')],
    }
    : {
      command: 'corepack',
      args: ['pnpm', ...args],
    }
);

const run = (name, args, env = {}) => new Promise((resolve) => {
  const invocation = buildCorepackInvocation(args);
  const child = spawn(invocation.command, invocation.args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PATH: process.env.PATH || process.env.Path,
      CODEXMUX_SMOKE_ARTIFACT_DIR: artifactRoot,
      ...env,
    },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  const started = Date.now();

  child.on('exit', (code) => {
    resolve({
      name,
      status: code === 0 ? 'passed' : 'failed',
      durationMs: Date.now() - started,
      exitCode: code,
      error: code === 0 ? null : 'command-failed',
    });
  });
});

const main = async () => {
  await fs.mkdir(artifactRoot, { recursive: true });
  const rows = [];

  rows.push(await run('browser-reconnect', ['smoke:browser-reconnect']));

  if (process.env.CODEXMUX_OPS_SMOKE_PWA_URL) {
    rows.push(await run('pwa', ['smoke:pwa'], {
      CODEXMUX_PWA_SMOKE_URL: process.env.CODEXMUX_OPS_SMOKE_PWA_URL,
    }));
  } else {
    rows.push({
      name: 'pwa',
      status: 'manual-required',
      reason: 'CODEXMUX_OPS_SMOKE_PWA_URL not set',
    });
  }

  if (process.env.CODEXMUX_OPS_SMOKE_RUNTIME_URL) {
    rows.push(await run('runtime-v2-phase6-default-gate', ['smoke:runtime-v2:phase6-default-gate'], {
      ...buildEnvAlias('CODEXMUX_RUNTIME_V2_SMOKE_URL', process.env.CODEXMUX_OPS_SMOKE_RUNTIME_URL),
    }));
  } else {
    rows.push({
      name: 'runtime-v2-phase6-default-gate',
      status: 'manual-required',
      reason: 'CODEXMUX_OPS_SMOKE_RUNTIME_URL not set',
    });
  }

  rows.push({
    name: 'ipad-pwa-long-background',
    status: 'manual-required',
    reason: 'requires real iPad/PWA background run',
  });
  rows.push({
    name: 'mac-packaged-ux',
    status: 'manual-required',
    reason: 'requires packaged app UX run on macOS desktop session',
  });

  const failed = rows.some((row) => row.status === 'failed');
  const payload = {
    ok: !failed,
    artifactRoot,
    rows,
  };
  await writeSmokeArtifact({
    smokeName: 'ops-smoke-batch',
    status: failed ? 'failed' : 'passed',
    startedAt,
    payload,
    env: { ...process.env, CODEXMUX_SMOKE_ARTIFACT_DIR: artifactRoot },
  });
  console.log(JSON.stringify(payload, null, 2));
  process.exit(failed ? 1 : 0);
};

main().catch((err) => {
  console.error(JSON.stringify({
    ok: false,
    code: 'ops-smoke-batch-failed',
    message: err instanceof Error ? err.message : String(err),
  }, null, 2));
  process.exit(1);
});
