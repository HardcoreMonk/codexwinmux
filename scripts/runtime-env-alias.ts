type TRuntimeScriptEnv = NodeJS.ProcessEnv | Record<string, string | undefined>;

const hasEnvValue = (value: string | undefined): value is string =>
  value !== undefined && value !== '';

export const preferredRuntimeEnvKey = (legacyKey: string): string =>
  legacyKey.replace(/^CODEXMUX_/, 'CODEXWINMUX_');

export const readRuntimeEnvAlias = (
  env: TRuntimeScriptEnv,
  legacyKey: string,
): string | undefined => {
  const preferredKey = preferredRuntimeEnvKey(legacyKey);
  if (hasEnvValue(env[preferredKey])) return env[preferredKey];
  return env[legacyKey];
};

export const buildRuntimeEnvAlias = (
  legacyKey: string,
  value: string,
): Record<string, string> => ({
  [preferredRuntimeEnvKey(legacyKey)]: value,
  [legacyKey]: value,
});

export const writeRuntimeEnvAlias = (
  env: TRuntimeScriptEnv,
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

export const captureRuntimeEnvAliases = (
  env: TRuntimeScriptEnv,
  legacyKeys: string[],
): Record<string, string | undefined> =>
  Object.fromEntries(legacyKeys.flatMap((legacyKey) => {
    const preferredKey = preferredRuntimeEnvKey(legacyKey);
    return [
      [preferredKey, env[preferredKey]],
      [legacyKey, env[legacyKey]],
    ];
  }));

export const restoreRuntimeEnvSnapshot = (
  env: TRuntimeScriptEnv,
  snapshot: Record<string, string | undefined>,
): void => {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) {
      delete env[key];
    } else {
      env[key] = value;
    }
  }
};
