import path from 'path';
import { resolveHostPaths, type THostPathsEnv } from '@/lib/host-paths';
import {
  resolveWindowsServiceHostPlan,
  type IWindowsServiceHostPlan,
} from '@/lib/windows-service-host';

export interface IWindowsHostDiagnosticsInput {
  platform?: NodeJS.Platform;
  env?: THostPathsEnv;
  appDir?: string;
  baseUrl?: string;
}

export interface IWindowsHostDiagnostics {
  platform: NodeJS.Platform;
  skipped: boolean;
  reason: string | null;
  mutatesSystem: false;
  paths: {
    dataDir: string;
    codexDir: string;
    logDir: string;
    supportBundleDir: string;
  };
  hostBinding: {
    bindHost: string;
    probeHost: string;
    port: string;
  };
  health: {
    baseUrl: string;
    healthUrl: string;
    runtimeHealthUrl: string;
    authenticatedRuntimeHealth: boolean;
  };
  serviceHost: Pick<IWindowsServiceHostPlan, 'owner' | 'hostModel' | 'requiresElevation' | 'service'>;
}

const wildcardHosts = new Set(['0.0.0.0', '::', '*', '[::]']);

const trimTrailingSlashes = (value: string): string => value.replace(/\/+$/, '');

const formatUrlHost = (host: string): string => {
  if (host.startsWith('[') && host.endsWith(']')) return host;
  return host.includes(':') ? `[${host}]` : host;
};

const resolveProbeHost = (host: string): string => {
  const firstHost = host.split(',')[0]?.trim() || '127.0.0.1';
  return wildcardHosts.has(firstHost) ? '127.0.0.1' : firstHost;
};

const resolveHealthBaseUrl = (
  serviceHostPlan: IWindowsServiceHostPlan,
  baseUrl?: string,
): { baseUrl: string; bindHost: string; probeHost: string; port: string } => {
  if (baseUrl) {
    const parsedUrl = new URL(baseUrl);
    const port = parsedUrl.port || (parsedUrl.protocol === 'https:' ? '443' : '80');
    const host = parsedUrl.hostname || '127.0.0.1';
    return {
      baseUrl: trimTrailingSlashes(baseUrl),
      bindHost: serviceHostPlan.process.env.HOST,
      probeHost: host,
      port,
    };
  }

  const bindHost = serviceHostPlan.process.env.HOST;
  const probeHost = resolveProbeHost(bindHost);
  const port = serviceHostPlan.process.env.PORT;

  return {
    bindHost,
    probeHost,
    port,
    baseUrl: `http://${formatUrlHost(probeHost)}:${port}`,
  };
};

export const resolveWindowsHostDiagnostics = ({
  platform = process.platform,
  env = process.env,
  appDir = process.cwd(),
  baseUrl,
}: IWindowsHostDiagnosticsInput = {}): IWindowsHostDiagnostics => {
  const serviceHostPlan = resolveWindowsServiceHostPlan({
    platform,
    env,
    appDir,
  });
  const hostPaths = resolveHostPaths({
    platform,
    env,
  });
  const supportBundleDir = platform === 'win32' && hostPaths.localAppData
    ? path.win32.join(hostPaths.localAppData, 'codexwinmux', 'support')
    : path.posix.join(hostPaths.dataDir, 'support');
  const healthBinding = resolveHealthBaseUrl(serviceHostPlan, baseUrl);
  const healthBaseUrl = trimTrailingSlashes(healthBinding.baseUrl);

  return {
    platform,
    skipped: platform !== 'win32',
    reason: platform === 'win32'
      ? serviceHostPlan.reason
      : 'windows-host-diagnostics-only-runs-on-win32',
    mutatesSystem: false,
    paths: {
      dataDir: hostPaths.dataDir,
      codexDir: hostPaths.codexDir,
      logDir: hostPaths.logDir,
      supportBundleDir,
    },
    hostBinding: {
      bindHost: healthBinding.bindHost,
      probeHost: healthBinding.probeHost,
      port: healthBinding.port,
    },
    health: {
      baseUrl: healthBaseUrl,
      healthUrl: `${healthBaseUrl}/api/health`,
      runtimeHealthUrl: `${healthBaseUrl}/api/v2/runtime/health`,
      authenticatedRuntimeHealth: true,
    },
    serviceHost: {
      owner: serviceHostPlan.owner,
      hostModel: serviceHostPlan.hostModel,
      requiresElevation: serviceHostPlan.requiresElevation,
      service: serviceHostPlan.service,
    },
  };
};
