import { resolveHostPaths, type THostPathsEnv } from '@/lib/host-paths';

export type TWindowsServiceHostOwner = 'tray' | 'service' | 'installer-background';
export type TWindowsServiceHostModel = 'tray-first-service-capable';

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

export const resolveWindowsServiceHostOwner = (
  env: TWindowsServiceHostEnv,
): IWindowsServiceHostOwnerResult => {
  const value = env.CODEXMUX_WINDOWS_HOST_OWNER?.trim().toLowerCase();
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
  const serviceName = env.CODEXMUX_WINDOWS_SERVICE_NAME?.trim() || defaultServiceName;
  const port = env.PORT?.trim() || defaultPort;
  const host = env.HOST?.trim() || defaultHost;

  return {
    platform,
    skipped: platform !== 'win32',
    reason: platform === 'win32'
      ? ownerResult.error ?? null
      : 'windows-service-host-only-runs-on-win32',
    owner,
    hostModel: 'tray-first-service-capable',
    mutatesSystem: false,
    requiresElevation: owner === 'service',
    service: {
      name: serviceName,
      displayName: serviceName,
      description: 'Runs the local codexmux Windows service host.',
    },
    process: {
      command: 'corepack',
      args: ['pnpm', 'start'],
      cwd: appDir,
      env: {
        CODEXMUX_RUNTIME_V2: '1',
        CODEXMUX_RUNTIME_TERMINAL_ADAPTER: 'windows',
        CODEXMUX_PROCESS_INSPECTOR_ADAPTER: 'windows',
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
