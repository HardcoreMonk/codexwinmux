import path from 'path';

export interface IWindowsCodexSessionSmokeEnvInput {
  env: NodeJS.ProcessEnv;
  homeDir: string;
}

export interface IWindowsCodexSessionJsonlPathInput {
  homeDir: string;
  sessionId: string;
  startedAt: string;
}

export interface IWindowsCodexSessionJsonlInput {
  sessionId: string;
  cwd: string;
  startedAt: string;
}

const timestampForPath = (startedAt: string): string =>
  startedAt
    .replace(/\.\d{3}Z$/, '')
    .replace(/:/g, '-');

const preferredCodexwinmuxEnvKey = (legacyKey: string): string =>
  legacyKey.replace(/^CODEXMUX_/, 'CODEXWINMUX_');

const buildEnvAlias = (legacyKey: string, value: string): Record<string, string> => ({
  [preferredCodexwinmuxEnvKey(legacyKey)]: value,
  [legacyKey]: value,
});

export const buildSyntheticCodexProcessArgs = (sessionId: string): string[] => [
  '-e',
  'setInterval(() => {}, 1000)',
  'codex',
  sessionId,
];

export const buildWindowsCodexSessionJsonlPath = ({
  homeDir,
  sessionId,
  startedAt,
}: IWindowsCodexSessionJsonlPathInput): string => {
  const date = new Date(startedAt);
  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return path.join(
    homeDir,
    '.codex',
    'sessions',
    year,
    month,
    day,
    `rollout-${timestampForPath(startedAt)}-${sessionId}.jsonl`,
  );
};

export const buildWindowsCodexSessionJsonl = ({
  sessionId,
  cwd,
  startedAt,
}: IWindowsCodexSessionJsonlInput): string => [
  JSON.stringify({
    timestamp: startedAt,
    type: 'session_meta',
    payload: {
      id: sessionId,
      timestamp: startedAt,
      cwd,
    },
  }),
  JSON.stringify({
    timestamp: startedAt,
    type: 'turn_context',
    payload: { cwd },
  }),
].join('\n');

export const createWindowsCodexSessionSmokeEnv = ({
  env,
  homeDir,
}: IWindowsCodexSessionSmokeEnvInput): NodeJS.ProcessEnv => ({
  ...env,
  HOME: homeDir,
  USERPROFILE: homeDir,
  ...buildEnvAlias('CODEXMUX_PROCESS_INSPECTOR_ADAPTER', 'windows'),
});
