export type TStorageShadowFixtureMode = 'legacy-shadow' | 'runtime-v2-api';

export interface IResolveStorageShadowFixtureModeInput {
  platform?: NodeJS.Platform;
  env?: Record<string, string | undefined>;
}

const hasEnvValue = (value: string | undefined): value is string =>
  value !== undefined && value.trim() !== '';

const readPreferredEnv = (
  env: Record<string, string | undefined>,
  legacyKey: string,
): string | undefined => {
  const preferredKey = legacyKey.replace(/^CODEXMUX_/, 'CODEXWINMUX_');
  return hasEnvValue(env[preferredKey]) ? env[preferredKey].trim() : undefined;
};

export const resolveStorageShadowFixtureMode = ({
  platform = process.platform,
  env = process.env,
}: IResolveStorageShadowFixtureModeInput = {}): TStorageShadowFixtureMode => {
  const requested = readPreferredEnv(env, 'CODEXWINMUX_RUNTIME_V2_STORAGE_SHADOW_FIXTURE');
  if (requested === 'legacy-shadow' || requested === 'runtime-v2-api') return requested;
  return platform === 'win32' ? 'runtime-v2-api' : 'legacy-shadow';
};
