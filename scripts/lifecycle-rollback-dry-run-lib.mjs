import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';

const runtimeEnvRe = /^Environment=((?:CODEXWINMUX|CODEXMUX)_RUNTIME_[A-Z0-9_]+)=(.*)$/;
const execFile = promisify(execFileCb);

export const rollbackRuntimeEnv = {
  CODEXWINMUX_RUNTIME_V2: '1',
  CODEXWINMUX_RUNTIME_STORAGE_V2_MODE: 'write',
  CODEXWINMUX_RUNTIME_TERMINAL_V2_MODE: 'off',
  CODEXWINMUX_RUNTIME_TIMELINE_V2_MODE: 'off',
  CODEXWINMUX_RUNTIME_STATUS_V2_MODE: 'off',
};

export const getDefaultRuntimeDropInPath = (homeDir = os.homedir()) =>
  path.join(homeDir, '.config', 'systemd', 'user', 'codexmux.service.d', 'runtime-v2-shadow.conf');

export const parseRuntimeDropIn = (content) => {
  const env = {};
  for (const line of content.split('\n')) {
    const match = line.trim().match(runtimeEnvRe);
    if (match) env[match[1]] = match[2];
  }
  return env;
};

export const buildRuntimeDropInContent = (env = rollbackRuntimeEnv) => [
  '[Service]',
  ...Object.entries(env).map(([key, value]) => `Environment=${key}=${value}`),
  '',
].join('\n');

const backupPathFor = (dropInPath, stamp) => `${dropInPath}.${stamp}.bak`;

const defaultBackupStamp = () => new Date().toISOString().replace(/[:.]/g, '-');

const systemctlFailureCode = (args) =>
  args.includes('restart') ? 'systemctl-restart-failed' : 'systemctl-daemon-reload-failed';

const runSystemctl = async (args, exec = execFile) => {
  try {
    await exec('systemctl', args);
  } catch {
    throw new Error(systemctlFailureCode(args));
  }
  return { command: 'systemctl', args, ok: true };
};

export const buildLifecycleRollbackDryRun = async ({
  dropInPath = getDefaultRuntimeDropInPath(),
} = {}) => {
  let dropInExists = false;
  let runtimeEnv = {};

  try {
    const content = await fs.readFile(dropInPath, 'utf8');
    dropInExists = true;
    runtimeEnv = parseRuntimeDropIn(content);
  } catch {
    dropInExists = false;
  }

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    service: 'codexmux.service',
    dropInPath,
    dropInExists,
    runtimeEnv,
    targetEnv: rollbackRuntimeEnv,
    mutates: false,
    commands: [
      `write ${dropInPath} with rollback runtime flags`,
      'systemctl --user daemon-reload',
      'systemctl --user restart codexmux.service',
    ],
    warnings: dropInExists ? [] : ['runtime drop-in not found; rollback file would be created'],
  };
};

export const applyLifecycleRollbackMutation = async ({
  dropInPath = getDefaultRuntimeDropInPath(),
  generatedAt = new Date().toISOString(),
  backupStamp = defaultBackupStamp(),
  execFile: execute = execFile,
} = {}) => {
  let previousDropInExists = false;
  let backupPath = null;
  const warnings = [];

  await fs.mkdir(path.dirname(dropInPath), { recursive: true });

  try {
    await fs.access(dropInPath);
    previousDropInExists = true;
  } catch {
    previousDropInExists = false;
    warnings.push('runtime drop-in not found; rollback file created');
  }

  if (previousDropInExists) {
    backupPath = backupPathFor(dropInPath, backupStamp);
    await fs.copyFile(dropInPath, backupPath);
  }

  await fs.writeFile(dropInPath, buildRuntimeDropInContent(rollbackRuntimeEnv), { mode: 0o600 });
  await fs.chmod(dropInPath, 0o600);

  const systemctl = [
    await runSystemctl(['--user', 'daemon-reload'], execute),
    await runSystemctl(['--user', 'restart', 'codexmux.service'], execute),
  ];

  return {
    schemaVersion: 1,
    generatedAt,
    service: 'codexmux.service',
    dropInPath,
    backupPath,
    previousDropInExists,
    appliedEnv: rollbackRuntimeEnv,
    mutates: true,
    systemctl,
    warnings,
  };
};
