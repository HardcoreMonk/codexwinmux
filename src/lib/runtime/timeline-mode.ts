import { hasOwnRuntimeOption, isRuntimeV2Enabled, readRuntimeEnvAlias } from '@/lib/runtime/env';

export type TRuntimeTimelineV2Mode = 'off' | 'shadow' | 'default';
const defaultRuntimeTimelineV2Mode: TRuntimeTimelineV2Mode = 'default';

export interface IRuntimeTimelineV2ModeOptions {
  runtimeV2Enabled?: boolean;
  timelineMode?: unknown;
}

export const parseRuntimeTimelineV2Mode = (value: unknown): TRuntimeTimelineV2Mode => {
  if (value === 'off') return 'off';
  if (value === 'shadow' || value === 'default') return value;
  return 'off';
};

export const resolveRuntimeTimelineV2Mode = (
  options: IRuntimeTimelineV2ModeOptions = {},
): TRuntimeTimelineV2Mode => {
  const runtimeV2Enabled = hasOwnRuntimeOption(options, 'runtimeV2Enabled')
    ? options.runtimeV2Enabled
    : isRuntimeV2Enabled();
  const timelineMode = hasOwnRuntimeOption(options, 'timelineMode')
    ? options.timelineMode
    : readRuntimeEnvAlias(process.env, 'CODEXWINMUX_RUNTIME_TIMELINE_V2_MODE');
  if (timelineMode === undefined && runtimeV2Enabled) return defaultRuntimeTimelineV2Mode;
  return parseRuntimeTimelineV2Mode(timelineMode);
};

export const getRuntimeTimelineV2Mode = (env: NodeJS.ProcessEnv = process.env): TRuntimeTimelineV2Mode =>
  resolveRuntimeTimelineV2Mode({
    runtimeV2Enabled: isRuntimeV2Enabled(env),
    timelineMode: readRuntimeEnvAlias(env, 'CODEXWINMUX_RUNTIME_TIMELINE_V2_MODE'),
  });

export const shouldUseRuntimeTimelineV2Live = (
  options: IRuntimeTimelineV2ModeOptions = {},
): boolean => {
  const runtimeV2Enabled = hasOwnRuntimeOption(options, 'runtimeV2Enabled')
    ? options.runtimeV2Enabled
    : isRuntimeV2Enabled();
  const timelineMode = hasOwnRuntimeOption(options, 'timelineMode')
    ? options.timelineMode
    : readRuntimeEnvAlias(process.env, 'CODEXWINMUX_RUNTIME_TIMELINE_V2_MODE');
  if (!runtimeV2Enabled) return false;
  return resolveRuntimeTimelineV2Mode({ runtimeV2Enabled, timelineMode }) === 'default';
};

export const shouldUseRuntimeTimelineV2Reads = (
  options: IRuntimeTimelineV2ModeOptions = {},
): boolean => {
  const runtimeV2Enabled = hasOwnRuntimeOption(options, 'runtimeV2Enabled')
    ? options.runtimeV2Enabled
    : isRuntimeV2Enabled();
  const timelineMode = hasOwnRuntimeOption(options, 'timelineMode')
    ? options.timelineMode
    : readRuntimeEnvAlias(process.env, 'CODEXWINMUX_RUNTIME_TIMELINE_V2_MODE');
  if (!runtimeV2Enabled) return false;
  return resolveRuntimeTimelineV2Mode({ runtimeV2Enabled, timelineMode }) === 'default';
};

export const shouldRunRuntimeTimelineV2Shadow = (
  options: IRuntimeTimelineV2ModeOptions = {},
): boolean => {
  const runtimeV2Enabled = hasOwnRuntimeOption(options, 'runtimeV2Enabled')
    ? options.runtimeV2Enabled
    : isRuntimeV2Enabled();
  const timelineMode = hasOwnRuntimeOption(options, 'timelineMode')
    ? options.timelineMode
    : readRuntimeEnvAlias(process.env, 'CODEXWINMUX_RUNTIME_TIMELINE_V2_MODE');
  if (!runtimeV2Enabled) return false;
  return resolveRuntimeTimelineV2Mode({ runtimeV2Enabled, timelineMode }) === 'shadow';
};
