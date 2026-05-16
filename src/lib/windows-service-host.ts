import path from 'path';
import { resolveHostPaths, type THostPathsEnv } from '@/lib/host-paths';
import { buildRuntimeEnvAliasRecord } from '@/lib/runtime/env';

export type TWindowsServiceHostOwner = 'tray' | 'service' | 'installer-background';
export type TWindowsServiceHostModel = 'tray-first-service-capable' | 'windows-service-owner-capable';
export type TWindowsServiceHostMode = 'combined' | 'split';
export type TWindowsServiceRole = 'combined' | 'backend' | 'core';

export interface IWindowsServiceCommandPlan {
  program: string;
  args: string[];
  mutatesSystem: false;
  requiresElevation: boolean;
}

export interface IWindowsServiceDefinition {
  role: TWindowsServiceRole;
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
  mode?: TWindowsServiceHostMode;
}

export interface IWindowsServiceHostPlan {
  platform: NodeJS.Platform;
  mode: TWindowsServiceHostMode;
  skipped: boolean;
  reason: string | null;
  owner: TWindowsServiceHostOwner;
  hostModel: TWindowsServiceHostModel;
  mutatesSystem: false;
  requiresElevation: boolean;
  operationDecision: {
    serviceAccount: {
      current: 'LocalSystem';
      mode: 'local-system-now';
      target: 'dedicated-local-service-account';
      serviceAccountName: 'codexwinmux-svc';
      next: 'profile-acl-credential-migration-before-long-running-ops';
    };
    installer: {
      mode: 'runbook-first';
      nsisServiceOption: 'runbook-default-off';
      defaultEnabled: false;
      promotionGate: 'account-acl-upgrade-uninstall-reboot-health-smoke';
    };
    runbook: {
      helperScript: 'scripts/windows-service.ps1';
      actions: ['write-config', 'install', 'start', 'stop', 'restart', 'status', 'health', 'uninstall'];
      splitActions: ['write-config', 'install', 'start', 'restart', 'status', 'health', 'stop', 'uninstall'];
    };
  };
  service: IWindowsServiceDefinition;
  splitServices: {
    defaultEnabled: true;
    backend: IWindowsServiceDefinition;
    core: IWindowsServiceDefinition;
  } | null;
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
const defaultBackendServiceName = 'codexwinmux-backend';
const defaultCoreServiceName = 'codexwinmux-core';
const operationDecision: IWindowsServiceHostPlan['operationDecision'] = {
  serviceAccount: {
    current: 'LocalSystem',
    mode: 'local-system-now',
    target: 'dedicated-local-service-account',
    serviceAccountName: 'codexwinmux-svc',
    next: 'profile-acl-credential-migration-before-long-running-ops',
  },
  installer: {
    mode: 'runbook-first',
    nsisServiceOption: 'runbook-default-off',
    defaultEnabled: false,
    promotionGate: 'account-acl-upgrade-uninstall-reboot-health-smoke',
  },
  runbook: {
    helperScript: 'scripts/windows-service.ps1',
    actions: ['write-config', 'install', 'start', 'stop', 'restart', 'status', 'health', 'uninstall'],
    splitActions: ['write-config', 'install', 'start', 'restart', 'status', 'health', 'stop', 'uninstall'],
  },
};

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

const resolvePackagedCoreHostScriptPath = (executablePath: string): string =>
  path.win32.join(
    path.win32.dirname(executablePath),
    'resources',
    'app.asar.unpacked',
    'dist',
    'workers',
    'core-engine-host.js',
  );

const resolvePackagedBackendServerScriptPath = (executablePath: string): string =>
  path.win32.join(
    path.win32.dirname(executablePath),
    'resources',
    'app.asar',
    'dist',
    'server.js',
  );

const resolveServiceWrapperPaths = (
  env: TWindowsServiceHostEnv,
  localAppData: string | undefined,
  serviceName = defaultServiceName,
  envPrefix = 'CODEXWINMUX_WINDOWS_SERVICE',
) => {
  const serviceDir = localAppData
    ? path.win32.join(localAppData, 'codexwinmux', 'service')
    : path.win32.join('C:\\ProgramData', 'codexwinmux', 'service');
  const executablePath = readEnv(env, `${envPrefix}_WRAPPER_EXE`)
    || (envPrefix === 'CODEXWINMUX_WINDOWS_SERVICE' ? readEnv(env, 'CODEXMUX_WINDOWS_SERVICE_WRAPPER_EXE') : undefined)
    || path.win32.join(serviceDir, `${serviceName}-service.exe`);
  const configPath = readEnv(env, `${envPrefix}_CONFIG`)
    || (envPrefix === 'CODEXWINMUX_WINDOWS_SERVICE' ? readEnv(env, 'CODEXMUX_WINDOWS_SERVICE_CONFIG') : undefined)
    || path.win32.join(path.win32.dirname(executablePath), `${serviceName}-service.xml`);

  return {
    kind: 'winsw' as const,
    executablePath,
    configPath,
  };
};

const buildServiceDefinition = ({
  role,
  name,
  description,
  executablePath,
  executableArgs,
  wrapper,
}: {
  role: TWindowsServiceRole;
  name: string;
  description: string;
  executablePath: string;
  executableArgs: string[];
  wrapper: IWindowsServiceDefinition['wrapper'];
}): IWindowsServiceDefinition => ({
  role,
  name,
  displayName: name,
  description,
  executablePath,
  executableArgs,
  wrapper,
  commands: buildServiceCommands({
    wrapperPath: wrapper.executablePath,
    requiresElevation: true,
  }),
});

const buildServiceCommands = ({
  wrapperPath,
  requiresElevation,
}: {
  wrapperPath: string;
  requiresElevation: boolean;
}) => {
  return {
    install: buildWindowsServiceCommandPlan(wrapperPath, ['install'], requiresElevation),
    uninstall: buildWindowsServiceCommandPlan(wrapperPath, ['uninstall'], requiresElevation),
    start: buildWindowsServiceCommandPlan(wrapperPath, ['start'], requiresElevation),
    stop: buildWindowsServiceCommandPlan(wrapperPath, ['stop'], requiresElevation),
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
  mode = 'split',
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
  const executableArgs = [resolvePackagedBackendServerScriptPath(executablePath)];
  const coreExecutableArgs = [resolvePackagedCoreHostScriptPath(executablePath)];
  const description = 'Runs the local codexwinmux Windows service host.';
  const wrapper = resolveServiceWrapperPaths(env, hostPaths.localAppData);
  const requiresElevation = owner === 'service';
  const combinedService = buildServiceDefinition({
    role: 'combined',
    name: serviceName,
    description,
    executablePath,
    executableArgs,
    wrapper,
  });
  const backendName = readEnv(env, 'CODEXWINMUX_WINDOWS_BACKEND_SERVICE_NAME') || defaultBackendServiceName;
  const coreName = readEnv(env, 'CODEXWINMUX_WINDOWS_CORE_SERVICE_NAME') || defaultCoreServiceName;
  const splitServices = mode === 'split'
    ? {
        defaultEnabled: true as const,
        backend: buildServiceDefinition({
          role: 'backend',
          name: backendName,
          description: 'Runs the codexwinmux Backend API/WebSocket host.',
          executablePath,
          executableArgs,
          wrapper: resolveServiceWrapperPaths(
            env,
            hostPaths.localAppData,
            backendName,
            'CODEXWINMUX_WINDOWS_BACKEND_SERVICE',
          ),
        }),
        core: buildServiceDefinition({
          role: 'core',
          name: coreName,
          description: 'Runs the codexwinmux Core Engine host.',
          executablePath,
          executableArgs: coreExecutableArgs,
          wrapper: resolveServiceWrapperPaths(
            env,
            hostPaths.localAppData,
            coreName,
            'CODEXWINMUX_WINDOWS_CORE_SERVICE',
          ),
        }),
      }
    : null;

  return {
    platform,
    mode,
    skipped: platform !== 'win32',
    reason: platform === 'win32'
      ? ownerResult.error ?? null
      : 'windows-service-host-only-runs-on-win32',
    owner,
    hostModel: owner === 'service' ? 'windows-service-owner-capable' : 'tray-first-service-capable',
    mutatesSystem: false,
    requiresElevation,
    operationDecision,
    service: combinedService,
    splitServices,
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
