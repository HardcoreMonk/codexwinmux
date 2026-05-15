import { spawn } from 'node:child_process';
import path from 'node:path';
import { stripLegacyRuntimeEnv } from './env-alias-lib.mjs';

export const LAN_DEV_RUNTIME_ENV = {
  CODEXWINMUX_RUNTIME_V2: '1',
  CODEXWINMUX_RUNTIME_STORAGE_V2_MODE: 'default',
  CODEXWINMUX_RUNTIME_TERMINAL_V2_MODE: 'new-tabs',
  CODEXWINMUX_RUNTIME_TIMELINE_V2_MODE: 'default',
  CODEXWINMUX_RUNTIME_STATUS_V2_MODE: 'default',
};

const hasEnvValue = (value) => value !== undefined && value !== null && String(value).trim() !== '';

export const buildLanDevServerEnv = ({
  env = process.env,
  platform = process.platform,
} = {}) => {
  const nextEnv = stripLegacyRuntimeEnv(env);

  delete nextEnv.CODEXMUX_PROCESS_INSPECTOR_ADAPTER;

  nextEnv.HOST = hasEnvValue(env.HOST) ? env.HOST : '0.0.0.0';
  nextEnv.PORT = hasEnvValue(env.PORT) ? env.PORT : '8121';
  Object.assign(nextEnv, LAN_DEV_RUNTIME_ENV);

  if (platform === 'win32') {
    nextEnv.CODEXWINMUX_RUNTIME_TERMINAL_ADAPTER = 'windows';
    nextEnv.CODEXWINMUX_PROCESS_INSPECTOR_ADAPTER = 'windows';
  }

  return nextEnv;
};

export const buildLanDevServerInvocation = ({
  platform = process.platform,
  env = process.env,
  nodePath = process.execPath,
} = {}) => ({
  command: platform === 'win32' ? nodePath : 'corepack',
  args: platform === 'win32'
    ? [path.join(path.dirname(nodePath), 'node_modules', 'corepack', 'dist', 'corepack.js'), 'pnpm', 'dev']
    : ['pnpm', 'dev'],
  env: buildLanDevServerEnv({ env, platform }),
});

export const runLanDevServer = ({
  platform = process.platform,
  env = process.env,
  spawnImpl = spawn,
} = {}) => {
  const invocation = buildLanDevServerInvocation({ platform, env });
  const child = spawnImpl(invocation.command, invocation.args, {
    stdio: 'inherit',
    env: invocation.env,
  });
  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 0);
  });
  return child;
};
