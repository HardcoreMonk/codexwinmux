import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

export const buildElectronBuilderArgs = ({ dir = false, extraArgs = [] } = {}) => [
  '--win',
  ...(dir ? ['--dir'] : []),
  '--config.npmRebuild=false',
  ...extraArgs,
];

export const buildElectronBuilderEnv = ({ env = process.env, shimDir }) => {
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? 'PATH';
  const currentPath = env[pathKey];

  return {
    ...env,
    [pathKey]: currentPath ? `${shimDir}${path.win32.delimiter}${currentPath}` : shimDir,
  };
};

export const createPnpmShim = (shimDir) => {
  fs.mkdirSync(shimDir, { recursive: true });

  if (process.platform === 'win32') {
    const shimPath = path.join(shimDir, 'pnpm.cmd');
    fs.writeFileSync(shimPath, '@echo off\r\ncorepack pnpm %*\r\n');
    return shimPath;
  }

  const shimPath = path.join(shimDir, 'pnpm');
  fs.writeFileSync(shimPath, '#!/usr/bin/env sh\nexec corepack pnpm "$@"\n', { mode: 0o755 });
  return shimPath;
};

export const readElectronVersion = (cwd = process.cwd()) => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(cwd, 'node_modules', 'electron', 'package.json'), 'utf8'));
  return packageJson.version;
};

export const buildElectronNativePrebuildTasks = ({
  cwd = process.cwd(),
  electronVersion,
  arch = 'x64',
} = {}) => [
  {
    packageName: 'better-sqlite3',
    cwd: path.win32.join(cwd, '.next', 'standalone', 'node_modules', 'better-sqlite3'),
    args: [
      '--runtime',
      'electron',
      '--target',
      electronVersion,
      '--arch',
      arch,
      '--platform',
      'win32',
    ],
  },
];

export const installElectronNativePrebuilds = async ({
  cwd = process.cwd(),
  electronVersion = readElectronVersion(cwd),
  arch = 'x64',
  stdio = 'inherit',
} = {}) => {
  const prebuildInstallCli = path.join(cwd, 'node_modules', 'prebuild-install', 'bin.js');
  const tasks = buildElectronNativePrebuildTasks({ cwd, electronVersion, arch });

  for (const task of tasks) {
    if (!fs.existsSync(task.cwd)) {
      throw new Error(`Electron native package is missing from standalone bundle: ${task.packageName}`);
    }
    const result = await new Promise((resolve) => {
      const child = spawn(process.execPath, [prebuildInstallCli, ...task.args], {
        cwd: task.cwd,
        stdio,
      });
      child.once('close', (exitCode, signal) => resolve({ exitCode, signal }));
    });
    if (result.exitCode !== 0 || result.signal) {
      throw new Error(`Electron native prebuild install failed for ${task.packageName}: ${JSON.stringify(result)}`);
    }
  }

  return tasks.map((task) => task.packageName);
};

export const runElectronBuilder = ({
  cwd = process.cwd(),
  dir = false,
  env = process.env,
  extraArgs = [],
  stdio = 'inherit',
} = {}) => {
  const run = async () => {
    await installElectronNativePrebuilds({ cwd, stdio });
    const shimDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codexmux-electron-builder-'));
    createPnpmShim(shimDir);

    return new Promise((resolve) => {
      const builderCli = path.join(cwd, 'node_modules', 'electron-builder', 'cli.js');
      const child = spawn(process.execPath, [builderCli, ...buildElectronBuilderArgs({ dir, extraArgs })], {
        cwd,
        env: buildElectronBuilderEnv({ env, shimDir }),
        stdio,
      });

      child.on('close', (exitCode, signal) => {
        fs.rmSync(shimDir, { recursive: true, force: true });
        resolve({ exitCode, signal });
      });
    });
  };

  return run();
};
