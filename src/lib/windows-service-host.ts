import path from 'path';
import { resolveHostPaths, type THostPathsEnv } from '@/lib/host-paths';
import { buildRuntimeEnvAliasRecord } from '@/lib/runtime/env';

export type TWindowsServiceHostOwner = 'tray' | 'service' | 'installer-background';
export type TWindowsServiceHostModel = 'tray-first-service-capable' | 'windows-service-owner-capable';

export interface IWindowsServiceCommandPlan {
  program: string;
  args: string[];
  mutatesSystem: false;
  requiresElevation: boolean;
}

export interface IWindowsServiceHostOwnerResult {
  ok: boolean;
  owner?: TWindowsServiceHostOwner;
  error?: 'unsupported-windows-host-owner';
  value?: string;
}

type TWindowsServiceHostEnv = THostPathsEnv;

export interface IWindowsServiceHostPlanInput {
  platform?: NodeJS.Platform;
  env?: TWindowsServiceHostEnv;
  appDir?: string;
}

export interface IWindowsServiceHostPlan {
  platform: NodeJS.Platform;
  skipped: boolean;
  reason: string | null;
  owner: TWindowsServiceHostOwner;
  hostModel: TWindowsServiceHostModel;
  mutatesSystem: false;
  requiresElevation: boolean;
  service: {
    name: string;
    displayName: string;
    description: string;
    executablePath: string;
    executableArgs: string[];
    wrapper: {
      kind: 'winsw';
      executablePath: string;
      configPath: string;
    };
    commands: {
      install: IWindowsServiceCommandPlan;
      uninstall: IWindowsServiceCommandPlan;
      start: IWindowsServiceCommandPlan;
      stop: IWindowsServiceCommandPlan;
    };
  };
  process: {
    command: string;
    args: string[];
    cwd: string;
    env: Record<string, string>;
  };
  paths: {
    dataDir: string;
    codexDir: string;
    logDir: string;
  };
  restartPolicy: {
    strategy: 'installer-or-service-manager';
    maxRestarts: number;
  };
}

const defaultPort = '8121';
const defaultHost = '127.0.0.1';
const defaultServiceName = 'codexwinmux';
const engineProcessFlag = '--codexwinmux-engine';

const readEnv = (env: TWindowsServiceHostEnv, key: string): string | undefined => {
  const value = env[key]?.trim();
  return value ? value : undefined;
};

const buildWindowsServiceCommandPlan = (
  program: string,
  args: string[],
  requiresElevation: boolean,
): IWindowsServiceCommandPlan => ({
  program,
  args,
  mutatesSystem: false,
  requiresElevation,
});

const resolveServiceExecutablePath = (
  env: TWindowsServiceHostEnv,
  appDir: string,
): string =>
  readEnv(env, 'CODEXWINMUX_WINDOWS_SERVICE_EXE')
  || readEnv(env, 'CODEXMUX_WINDOWS_SERVICE_EXE')
  || readEnv(env, 'CODEXWINMUX_WINDOWS_PACKAGED_APP_PATH')
  || readEnv(env, 'CODEXMUX_WINDOWS_PACKAGED_APP_PATH')
  || (appDir.toLowerCase().endsWith('.exe') ? appDir : `${appDir}\\codexwinmux.exe`);

const resolveServiceWrapperPaths = (
  env: TWindowsServiceHostEnv,
  localAppData: string | undefined,
) => {
  const serviceDir = localAppData
    ? path.win32.join(localAppData, 'codexwinmux', 'service')
    : path.win32.join('C:\\ProgramData', 'codexwinmux', 'service');
  const executablePath = readEnv(env, 'CODEXWINMUX_WINDOWS_SERVICE_WRAPPER_EXE')
    || readEnv(env, 'CODEXMUX_WINDOWS_SERVICE_WRAPPER_EXE')
    || path.win32.join(serviceDir, 'codexwinmux-service.exe');
  const configPath = readEnv(env, 'CODEXWINMUX_WINDOWS_SERVICE_CONFIG')
    || readEnv(env, 'CODEXMUX_WINDOWS_SERVICE_CONFIG')
    || path.win32.join(path.win32.dirname(executablePath), 'codexwinmux-service.xml');

  return {
    kind: 'winsw' as const,
    executablePath,
    configPath,
  };
};

const buildServiceCommands = ({
  wrapperPath,
}: {
  wrapperPath: string;
}) => {
  return {
    install: buildWindowsServiceCommandPlan(wrapperPath, ['install'], true),
    uninstall: buildWindowsServiceCommandPlan(wrapperPath, ['uninstall'], true),
    start: buildWindowsServiceCommandPlan(wrapperPath, ['start'], true),
    stop: buildWindowsServiceCommandPlan(wrapperPath, ['stop'], true),
  };
};

export const resolveWindowsServiceHostOwner = (
  env: TWindowsServiceHostEnv,
): IWindowsServiceHostOwnerResult => {
  const value = (
    readEnv(env, 'CODEXWINMUX_WINDOWS_HOST_OWNER')
    || readEnv(env, 'CODEXMUX_WINDOWS_HOST_OWNER')
  )?.toLowerCase();
  if (!value) return { ok: true, owner: 'tray' };
  if (value === 'tray' || value === 'service' || value === 'installer-background') {
    return { ok: true, owner: value };
  }
  return {
    ok: false,
    error: 'unsupported-windows-host-owner',
    value,
  };
};

export const resolveWindowsServiceHostPlan = ({
  platform = process.platform,
  env = process.env,
  appDir = process.cwd(),
}: IWindowsServiceHostPlanInput = {}): IWindowsServiceHostPlan => {
  const ownerResult = resolveWindowsServiceHostOwner(env);
  const owner = ownerResult.ok ? ownerResult.owner! : 'tray';
  const hostPaths = resolveHostPaths({ platform, env });
  const serviceName = readEnv(env, 'CODEXWINMUX_WINDOWS_SERVICE_NAME')
    || readEnv(env, 'CODEXMUX_WINDOWS_SERVICE_NAME')
    || defaultServiceName;
  const port = readEnv(env, 'PORT') || defaultPort;
  const host = readEnv(env, 'HOST') || defaultHost;
  const executablePath = resolveServiceExecutablePath(env, appDir);
  const executableArgs = [engineProcessFlag];
  const description = 'Runs the local codexwinmux Windows service host.';
  const wrapper = resolveServiceWrapperPaths(env, hostPaths.localAppData);

  return {
    platform,
    skipped: platform !== 'win32',
    reason: platform === 'win32'
      ? ownerResult.error ?? null
      : 'windows-service-host-only-runs-on-win32',
    owner,
    hostModel: owner === 'service' ? 'windows-service-owner-capable' : 'tray-first-service-capable',
    mutatesSystem: false,
    requiresElevation: owner === 'service',
    service: {
      name: serviceName,
      displayName: serviceName,
      description,
      executablePath,
      executableArgs,
      wrapper,
      commands: buildServiceCommands({
        wrapperPath: wrapper.executablePath,
      }),
    },
    process: {
      command: 'corepack',
      args: ['pnpm', 'start'],
      cwd: appDir,
      env: {
        ...buildRuntimeEnvAliasRecord('CODEXWINMUX_RUNTIME_V2', '1'),
        ...buildRuntimeEnvAliasRecord('CODEXWINMUX_RUNTIME_TERMINAL_ADAPTER', 'windows'),
        ...buildRuntimeEnvAliasRecord('CODEXMUX_PROCESS_INSPECTOR_ADAPTER', 'windows'),
        HOST: host,
        PORT: port,
      },
    },
    paths: {
      dataDir: hostPaths.dataDir,
      codexDir: hostPaths.codexDir,
      logDir: hostPaths.logDir,
    },
    restartPolicy: {
      strategy: 'installer-or-service-manager',
      maxRestarts: 3,
    },
  };
};
