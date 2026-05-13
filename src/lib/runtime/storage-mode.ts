import { hasOwnRuntimeOption, isRuntimeV2Enabled, readRuntimeEnvAlias } from '@/lib/runtime/env';

export type TRuntimeStorageV2Mode = 'off' | 'shadow' | 'write' | 'default';
const defaultRuntimeStorageV2Mode: TRuntimeStorageV2Mode = 'default';

export interface IRuntimeStorageV2ModeOptions {
  runtimeV2Enabled?: boolean;
  storageMode?: unknown;
}

export const parseRuntimeStorageV2Mode = (value: unknown): TRuntimeStorageV2Mode => {
  if (value === 'off') return 'off';
  if (value === 'shadow' || value === 'write' || value === 'default') return value;
  return 'off';
};

export const resolveRuntimeStorageV2Mode = (
  options: IRuntimeStorageV2ModeOptions = {},
): TRuntimeStorageV2Mode => {
  const runtimeV2Enabled = hasOwnRuntimeOption(options, 'runtimeV2Enabled')
    ? options.runtimeV2Enabled
    : isRuntimeV2Enabled();
  const storageMode = hasOwnRuntimeOption(options, 'storageMode')
    ? options.storageMode
    : readRuntimeEnvAlias(process.env, 'CODEXWINMUX_RUNTIME_STORAGE_V2_MODE');
  if (storageMode === undefined && runtimeV2Enabled) return defaultRuntimeStorageV2Mode;
  return parseRuntimeStorageV2Mode(storageMode);
};

export const getRuntimeStorageV2Mode = (env: NodeJS.ProcessEnv = process.env): TRuntimeStorageV2Mode =>
  resolveRuntimeStorageV2Mode({
    runtimeV2Enabled: isRuntimeV2Enabled(env),
    storageMode: readRuntimeEnvAlias(env, 'CODEXWINMUX_RUNTIME_STORAGE_V2_MODE'),
  });

export const shouldMirrorLegacyStorageToRuntimeV2 = (
  options: IRuntimeStorageV2ModeOptions = {},
): boolean => {
  const runtimeV2Enabled = hasOwnRuntimeOption(options, 'runtimeV2Enabled')
    ? options.runtimeV2Enabled
    : isRuntimeV2Enabled();
  const storageMode = hasOwnRuntimeOption(options, 'storageMode')
    ? options.storageMode
    : readRuntimeEnvAlias(process.env, 'CODEXWINMUX_RUNTIME_STORAGE_V2_MODE');
  if (!runtimeV2Enabled) return false;
  const mode = resolveRuntimeStorageV2Mode({ runtimeV2Enabled, storageMode });
  return mode === 'write' || mode === 'default';
};
