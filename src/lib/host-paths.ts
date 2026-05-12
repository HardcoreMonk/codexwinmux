import os from 'os';
import path from 'path';

export type THostPathsEnv = NodeJS.ProcessEnv | Record<string, string | undefined>;

export interface IHostPathsInput {
  platform?: NodeJS.Platform;
  env?: THostPathsEnv;
}

export interface IHostPaths {
  platform: NodeJS.Platform;
  homeDir: string;
  dataDir: string;
  codexDir: string;
  logDir: string;
  localAppData?: string;
}

const readEnv = (env: THostPathsEnv, key: string): string | undefined => {
  const value = env[key]?.trim();
  return value ? value : undefined;
};

const resolveHomeDir = (platform: NodeJS.Platform, env: THostPathsEnv): string => {
  if (platform === 'win32') {
    return readEnv(env, 'USERPROFILE') || readEnv(env, 'HOME') || os.homedir();
  }
  return readEnv(env, 'HOME') || readEnv(env, 'USERPROFILE') || os.homedir();
};

const resolveLocalAppData = (env: THostPathsEnv, homeDir: string): string =>
  readEnv(env, 'LOCALAPPDATA') || path.win32.join(homeDir, 'AppData', 'Local');

export const resolveHostPaths = ({
  platform = process.platform,
  env = process.env,
}: IHostPathsInput = {}): IHostPaths => {
  const homeDir = resolveHomeDir(platform, env);

  if (platform === 'win32') {
    const localAppData = resolveLocalAppData(env, homeDir);
    return {
      platform,
      homeDir,
      localAppData,
      dataDir: path.win32.join(homeDir, '.codexwinmux'),
      codexDir: path.win32.join(homeDir, '.codex'),
      logDir: path.win32.join(localAppData, 'codexwinmux', 'logs'),
    };
  }

  const dataDir = path.posix.join(homeDir, '.codexwinmux');

  return {
    platform,
    homeDir,
    dataDir,
    codexDir: path.posix.join(homeDir, '.codex'),
    logDir: path.posix.join(dataDir, 'logs'),
  };
};

export const resolveCodexmuxLogDir = (input?: IHostPathsInput): string =>
  resolveHostPaths(input).logDir;
