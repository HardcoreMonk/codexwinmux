export const engineProcessFlag = '--codexwinmux-engine';
export const coreProcessFlag = '--codexwinmux-core';

interface IEngineProcessEnv {
  CODEXWINMUX_ELECTRON_ENGINE_PROCESS?: string;
  CODEXMUX_ELECTRON_ENGINE_PROCESS?: string;
  CODEXWINMUX_ELECTRON_CORE_PROCESS?: string;
}

export const isEngineProcessLaunch = (
  argv: readonly string[],
  env: IEngineProcessEnv,
): boolean =>
  argv.includes(engineProcessFlag)
  || env.CODEXWINMUX_ELECTRON_ENGINE_PROCESS === '1'
  || env.CODEXMUX_ELECTRON_ENGINE_PROCESS === '1';

export const isCoreProcessLaunch = (
  argv: readonly string[],
  env: IEngineProcessEnv,
): boolean =>
  argv.includes(coreProcessFlag)
  || env.CODEXWINMUX_ELECTRON_CORE_PROCESS === '1';

export type TElectronProcessRole = 'ui' | 'engine' | 'core';

export const resolveElectronProcessRole = (
  argv: readonly string[],
  env: IEngineProcessEnv,
): TElectronProcessRole => {
  if (isCoreProcessLaunch(argv, env)) return 'core';
  if (isEngineProcessLaunch(argv, env)) return 'engine';
  return 'ui';
};

export const buildEngineProcessArgs = ({
  isPackaged,
  appPath,
}: {
  isPackaged: boolean;
  appPath: string;
}): string[] =>
  isPackaged ? [engineProcessFlag] : [appPath, engineProcessFlag];

export const buildCoreProcessArgs = ({
  isPackaged,
  appPath,
}: {
  isPackaged: boolean;
  appPath: string;
}): string[] =>
  isPackaged ? [coreProcessFlag] : [appPath, coreProcessFlag];

export interface ICoreBackendProcessLaunchPlanInput {
  isPackaged: boolean;
  appPath: string;
  backendHost: string;
  backendPort: number;
  coreHost: string;
  corePort: number;
  reservedPorts: string;
}

export interface ICoreBackendProcessLaunchPlan {
  core: {
    args: string[];
    env: Record<string, string>;
  };
  backend: {
    args: string[];
    env: Record<string, string>;
  };
}

export const buildCoreBackendProcessLaunchPlan = ({
  isPackaged,
  appPath,
  backendHost,
  backendPort,
  coreHost,
  corePort,
  reservedPorts,
}: ICoreBackendProcessLaunchPlanInput): ICoreBackendProcessLaunchPlan => {
  const coreTransportEnv = {
    CODEXWINMUX_CORE_ENGINE_TRANSPORT: 'tcp',
    CODEXWINMUX_CORE_ENGINE_HOST: coreHost,
    CODEXWINMUX_CORE_ENGINE_PORT: String(corePort),
  };
  return {
    core: {
      args: buildCoreProcessArgs({ isPackaged, appPath }),
      env: {
        CODEXWINMUX_ELECTRON_CORE_PROCESS: '1',
        ...coreTransportEnv,
      },
    },
    backend: {
      args: buildEngineProcessArgs({ isPackaged, appPath }),
      env: {
        CODEXWINMUX_ELECTRON_ENGINE_PROCESS: '1',
        CODEXMUX_ELECTRON_ENGINE_PROCESS: '1',
        ...coreTransportEnv,
        CODEXMUX_RESERVED_PORTS: reservedPorts,
        HOST: backendHost,
        PORT: String(backendPort),
      },
    },
  };
};
