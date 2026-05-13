import { pathToFileURL } from 'url';

export type TElectronEnv = NodeJS.ProcessEnv | Record<string, string | undefined>;

export interface IElectronBootstrapEnvInput {
  platform?: NodeJS.Platform;
  env?: TElectronEnv;
}

export interface IPackagedNodePathInput {
  platform?: NodeJS.Platform;
  standaloneModules: string;
  existingNodePath?: string;
}

const posixLaunchPathAdditions = [
  '/opt/homebrew/bin',
  '/usr/local/bin',
  '/usr/bin',
  '/bin',
  '/usr/sbin',
  '/sbin',
];

const pathDelimiterForPlatform = (platform: NodeJS.Platform): string =>
  platform === 'win32' ? ';' : ':';

const prependMissingPathEntries = (
  currentPath: string | undefined,
  additions: string[],
  delimiter: string,
): string => {
  const parts = (currentPath || '').split(delimiter).filter(Boolean);
  for (const dir of additions) {
    if (!parts.includes(dir)) parts.unshift(dir);
  }
  return parts.join(delimiter);
};

const hasEnvValue = (value: string | undefined): value is string =>
  value !== undefined && value !== '';

const preferredWindowsRuntimeAlias = (legacyKey: string): string =>
  legacyKey.replace(/^CODEXMUX_/, 'CODEXWINMUX_');

const isRuntimeLegacyKey = (legacyKey: string): boolean =>
  legacyKey.startsWith('CODEXMUX_RUNTIME_');

const isRuntimePreferredKey = (key: string): boolean =>
  key.startsWith('CODEXWINMUX_RUNTIME_');

const legacyWindowsRuntimeAlias = (preferredKey: string): string =>
  preferredKey.replace(/^CODEXWINMUX_/, 'CODEXMUX_');

const applyAliasedDefault = (
  env: Record<string, string | undefined>,
  legacyKey: string,
  value: string,
): void => {
  const preferredKey = preferredWindowsRuntimeAlias(legacyKey);
  const legacyRuntimeKey = legacyWindowsRuntimeAlias(preferredKey);
  const isRuntimeKey = isRuntimeLegacyKey(legacyKey) || isRuntimePreferredKey(preferredKey);
  const nextValue = hasEnvValue(env[preferredKey])
    ? env[preferredKey]
    : !isRuntimeKey && hasEnvValue(env[legacyKey])
      ? env[legacyKey]
      : value;

  env[preferredKey] = nextValue;
  if (isRuntimeKey) {
    delete env[legacyRuntimeKey];
  } else {
    env[legacyKey] = nextValue;
  }
};

const applyWindowsRuntimeDefaults = (env: Record<string, string | undefined>): void => {
  applyAliasedDefault(env, 'CODEXWINMUX_RUNTIME_V2', '1');
  applyAliasedDefault(env, 'CODEXWINMUX_RUNTIME_TERMINAL_V2_MODE', 'new-tabs');
  applyAliasedDefault(env, 'CODEXWINMUX_RUNTIME_STORAGE_V2_MODE', 'default');
  applyAliasedDefault(env, 'CODEXWINMUX_RUNTIME_TIMELINE_V2_MODE', 'default');
  applyAliasedDefault(env, 'CODEXWINMUX_RUNTIME_STATUS_V2_MODE', 'default');
  applyAliasedDefault(env, 'CODEXWINMUX_RUNTIME_TERMINAL_ADAPTER', 'windows');
  applyAliasedDefault(env, 'CODEXMUX_PROCESS_INSPECTOR_ADAPTER', 'windows');
};

export const buildElectronBootstrapEnv = ({
  platform = process.platform,
  env = process.env,
}: IElectronBootstrapEnvInput = {}): Record<string, string | undefined> => {
  const nextEnv: Record<string, string | undefined> = { ...env };

  if (platform === 'win32') {
    applyWindowsRuntimeDefaults(nextEnv);
    return nextEnv;
  }

  nextEnv.PATH = prependMissingPathEntries(
    nextEnv.PATH,
    posixLaunchPathAdditions,
    pathDelimiterForPlatform(platform),
  );
  if (!nextEnv.LANG) nextEnv.LANG = 'en_US.UTF-8';
  return nextEnv;
};

export const applyElectronBootstrapEnv = (
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): void => {
  const nextEnv = buildElectronBootstrapEnv({ platform, env });
  for (const [key, value] of Object.entries(nextEnv)) {
    if (value !== undefined) env[key] = value;
  }
};

export const buildPackagedNodePath = ({
  platform = process.platform,
  standaloneModules,
  existingNodePath,
}: IPackagedNodePathInput): string =>
  [standaloneModules, existingNodePath]
    .filter((value): value is string => !!value)
    .join(pathDelimiterForPlatform(platform));

export const buildFileImportSpecifier = (filePath: string): string => {
  if (/^[A-Za-z]:[\\/]/.test(filePath)) {
    return `file:///${filePath.replace(/\\/g, '/')}`;
  }
  return pathToFileURL(filePath).href;
};
