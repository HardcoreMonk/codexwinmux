export type TRuntimeEnv = NodeJS.ProcessEnv | Record<string, string | undefined>;

const hasEnvValue = (value: string | undefined): value is string =>
  value !== undefined && value !== '';

export const preferredRuntimeEnvKey = (legacyKey: string): string =>
  legacyKey.replace(/^CODEXMUX_/, 'CODEXWINMUX_');

export const readRuntimeEnvAlias = (
  env: TRuntimeEnv,
  legacyKey: string,
): string | undefined => {
  const preferredKey = preferredRuntimeEnvKey(legacyKey);
  if (hasEnvValue(env[preferredKey])) return env[preferredKey];
  return env[legacyKey];
};

export const writeRuntimeEnvAlias = (
  env: TRuntimeEnv,
  legacyKey: string,
  value: string | undefined,
): void => {
  const preferredKey = preferredRuntimeEnvKey(legacyKey);
  if (value === undefined) {
    delete env[preferredKey];
    delete env[legacyKey];
    return;
  }
  env[preferredKey] = value;
  env[legacyKey] = value;
};

export const buildRuntimeEnvAliasRecord = (
  legacyKey: string,
  value: string,
): Record<string, string> => ({
  [preferredRuntimeEnvKey(legacyKey)]: value,
  [legacyKey]: value,
});

export const isRuntimeV2Enabled = (
  env: TRuntimeEnv = process.env,
): boolean => readRuntimeEnvAlias(env, 'CODEXMUX_RUNTIME_V2') === '1';

export const readRuntimeDbPathEnv = (
  env: TRuntimeEnv = process.env,
): string | undefined => readRuntimeEnvAlias(env, 'CODEXMUX_RUNTIME_DB');

export const readRuntimeStorageMirrorDataDirEnv = (
  env: TRuntimeEnv = process.env,
): string | undefined => readRuntimeEnvAlias(env, 'CODEXMUX_RUNTIME_V2_STORAGE_MIRROR_DATA_DIR');

export const shouldResetRuntimeV2Env = (
  env: TRuntimeEnv = process.env,
): boolean => readRuntimeEnvAlias(env, 'CODEXMUX_RUNTIME_V2_RESET') === '1';

export const hasOwnRuntimeOption = (options: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(options, key);
