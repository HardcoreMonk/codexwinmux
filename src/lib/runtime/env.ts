const hasEnvValue = (value: string | undefined): value is string =>
  value !== undefined && value !== '';

export const preferredRuntimeEnvKey = (legacyKey: string): string =>
  legacyKey.replace(/^CODEXMUX_/, 'CODEXWINMUX_');

export const readRuntimeEnvAlias = (
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
  legacyKey: string,
): string | undefined => {
  const preferredKey = preferredRuntimeEnvKey(legacyKey);
  if (hasEnvValue(env[preferredKey])) return env[preferredKey];
  return env[legacyKey];
};

export const isRuntimeV2Enabled = (
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): boolean => readRuntimeEnvAlias(env, 'CODEXMUX_RUNTIME_V2') === '1';

export const hasOwnRuntimeOption = (options: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(options, key);
