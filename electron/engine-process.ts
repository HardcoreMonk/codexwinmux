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
