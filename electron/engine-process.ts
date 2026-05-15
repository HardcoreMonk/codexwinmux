export const engineProcessFlag = '--codexwinmux-engine';

interface IEngineProcessEnv {
  CODEXWINMUX_ELECTRON_ENGINE_PROCESS?: string;
  CODEXMUX_ELECTRON_ENGINE_PROCESS?: string;
}

export const isEngineProcessLaunch = (
  argv: readonly string[],
  env: IEngineProcessEnv,
): boolean =>
  argv.includes(engineProcessFlag)
  || env.CODEXWINMUX_ELECTRON_ENGINE_PROCESS === '1'
  || env.CODEXMUX_ELECTRON_ENGINE_PROCESS === '1';

export const buildEngineProcessArgs = ({
  isPackaged,
  appPath,
}: {
  isPackaged: boolean;
  appPath: string;
}): string[] =>
  isPackaged ? [engineProcessFlag] : [appPath, engineProcessFlag];
