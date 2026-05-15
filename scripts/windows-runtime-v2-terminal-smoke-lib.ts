import { buildRuntimeEnvAlias, stripLegacyRuntimeEnv } from './runtime-env-alias';

export interface IWindowsRuntimeV2TerminalSmokeEnvInput {
  env?: NodeJS.ProcessEnv;
  homeDir: string;
  dbPath: string;
  shell: string;
}

export const buildWindowsRuntimeSmokeEchoCommand = (marker: string): string =>
  `echo ${marker}\r`;

export const normalizeWindowsRuntimeSmokeOutput = (output: string): string =>
  output
    .replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '')
    .replace(/\r/g, '\n');

export const hasWindowsRuntimeSmokeMarker = (output: string, marker: string): boolean =>
  normalizeWindowsRuntimeSmokeOutput(output).includes(marker);

export const createWindowsRuntimeV2TerminalSmokeEnv = ({
  env = process.env,
  homeDir,
  dbPath,
  shell,
}: IWindowsRuntimeV2TerminalSmokeEnvInput): NodeJS.ProcessEnv => {
  const nextEnv: NodeJS.ProcessEnv = {
    ...stripLegacyRuntimeEnv(env),
    HOME: homeDir,
    USERPROFILE: homeDir,
    ...buildRuntimeEnvAlias('CODEXWINMUX_RUNTIME_V2', '1'),
    ...buildRuntimeEnvAlias('CODEXWINMUX_RUNTIME_DB', dbPath),
    ...buildRuntimeEnvAlias('CODEXWINMUX_RUNTIME_TERMINAL_ADAPTER', 'windows'),
    CODEXMUX_WINDOWS_SHELL: shell,
  };
  nextEnv.__CMUX_PRISTINE_ENV = JSON.stringify(nextEnv);
  return nextEnv;
};
