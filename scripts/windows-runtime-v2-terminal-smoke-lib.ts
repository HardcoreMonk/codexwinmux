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

const preferredCodexwinmuxEnvKey = (legacyKey: string): string =>
  legacyKey.replace(/^CODEXMUX_/, 'CODEXWINMUX_');

const buildEnvAlias = (legacyKey: string, value: string): Record<string, string> => ({
  [preferredCodexwinmuxEnvKey(legacyKey)]: value,
  ...(legacyKey.startsWith('CODEXMUX_RUNTIME_') ? {} : { [legacyKey]: value }),
});

const stripLegacyRuntimeEnv = (env: NodeJS.ProcessEnv): NodeJS.ProcessEnv =>
  Object.fromEntries(
    Object.entries(env).filter(([key]) => !key.startsWith('CODEXMUX_RUNTIME_')),
  ) as NodeJS.ProcessEnv;

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
    ...buildEnvAlias('CODEXWINMUX_RUNTIME_V2', '1'),
    ...buildEnvAlias('CODEXWINMUX_RUNTIME_DB', dbPath),
    ...buildEnvAlias('CODEXWINMUX_RUNTIME_TERMINAL_ADAPTER', 'windows'),
    CODEXMUX_WINDOWS_SHELL: shell,
  };
  nextEnv.__CMUX_PRISTINE_ENV = JSON.stringify(nextEnv);
  return nextEnv;
};
