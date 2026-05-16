export type TCoreEngineBackendTransportMode = 'tcp';
export type TCoreEngineHostTransportMode = 'process-ipc' | 'tcp';

export interface ICoreEngineTcpTransportConfig {
  host: string;
  port: number;
}

export interface ICoreEngineBackendTransportConfig extends ICoreEngineTcpTransportConfig {
  mode: TCoreEngineBackendTransportMode;
  requestTimeoutMs: number;
}

export interface ICoreEngineHostTransportConfig extends ICoreEngineTcpTransportConfig {
  mode: TCoreEngineHostTransportMode;
}

type TCoreEngineTransportEnv = Record<string, string | undefined>;

const defaultCoreEngineHost = '127.0.0.1';
const defaultCoreEnginePort = 8122;
const defaultRequestTimeoutMs = 10_000;

const readEnv = (env: TCoreEngineTransportEnv, key: string): string | undefined => {
  const value = env[key]?.trim();
  return value ? value : undefined;
};

const parsePositiveInt = (
  raw: string | undefined,
  fallback: number,
): number => {
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
};

const normalizeTransportMode = (raw: string | undefined): string | null =>
  raw?.trim().toLowerCase().replace(/_/g, '-') || null;

export const resolveCoreEngineTcpConfig = (
  env: TCoreEngineTransportEnv = process.env,
): ICoreEngineTcpTransportConfig => ({
  host: readEnv(env, 'CODEXWINMUX_CORE_ENGINE_HOST') || defaultCoreEngineHost,
  port: parsePositiveInt(readEnv(env, 'CODEXWINMUX_CORE_ENGINE_PORT'), defaultCoreEnginePort),
});

export const resolveCoreEngineBackendTransportConfig = ({
  env = process.env,
}: {
  env?: TCoreEngineTransportEnv;
} = {}): ICoreEngineBackendTransportConfig => {
  return {
    ...resolveCoreEngineTcpConfig(env),
    mode: 'tcp',
    requestTimeoutMs: parsePositiveInt(
      readEnv(env, 'CODEXWINMUX_CORE_ENGINE_REQUEST_TIMEOUT_MS'),
      defaultRequestTimeoutMs,
    ),
  };
};

export const resolveCoreEngineHostTransportConfig = ({
  env = process.env,
  hasProcessSend = typeof process.send === 'function',
}: {
  env?: TCoreEngineTransportEnv;
  hasProcessSend?: boolean;
} = {}): ICoreEngineHostTransportConfig => {
  const requestedMode = normalizeTransportMode(readEnv(env, 'CODEXWINMUX_CORE_ENGINE_TRANSPORT'));
  const mode: TCoreEngineHostTransportMode = requestedMode === 'tcp'
    ? 'tcp'
    : requestedMode === 'process-ipc' || requestedMode === 'ipc'
      ? 'process-ipc'
      : hasProcessSend
        ? 'process-ipc'
        : 'tcp';
  return {
    ...resolveCoreEngineTcpConfig(env),
    mode,
  };
};
