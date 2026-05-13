import type { TRuntimeVersion } from '@/types/terminal';
import { hasOwnRuntimeOption, isRuntimeV2Enabled, readRuntimeEnvAlias } from '@/lib/runtime/env';

export type TRuntimeTerminalV2Mode = 'off' | 'opt-in' | 'new-tabs' | 'default';
const defaultRuntimeTerminalV2Mode: TRuntimeTerminalV2Mode = 'new-tabs';

export interface IShouldCreateTerminalTabInRuntimeV2Options {
  runtimeV2Enabled?: boolean;
  terminalMode?: unknown;
  explicitOptIn?: boolean;
}

export const parseRuntimeTerminalV2Mode = (value: unknown): TRuntimeTerminalV2Mode => {
  if (value === 'off') return 'off';
  if (value === 'opt-in' || value === 'new-tabs' || value === 'default') return value;
  return 'off';
};

export const resolveRuntimeTerminalV2Mode = (
  options: Omit<IShouldCreateTerminalTabInRuntimeV2Options, 'explicitOptIn'> = {},
): TRuntimeTerminalV2Mode => {
  const runtimeV2Enabled = hasOwnRuntimeOption(options, 'runtimeV2Enabled')
    ? options.runtimeV2Enabled
    : isRuntimeV2Enabled();
  const terminalMode = hasOwnRuntimeOption(options, 'terminalMode')
    ? options.terminalMode
    : readRuntimeEnvAlias(process.env, 'CODEXWINMUX_RUNTIME_TERMINAL_V2_MODE');
  if (terminalMode === undefined && runtimeV2Enabled) return defaultRuntimeTerminalV2Mode;
  return parseRuntimeTerminalV2Mode(terminalMode);
};

export const getRuntimeTerminalV2Mode = (env: NodeJS.ProcessEnv = process.env): TRuntimeTerminalV2Mode =>
  resolveRuntimeTerminalV2Mode({
    runtimeV2Enabled: isRuntimeV2Enabled(env),
    terminalMode: readRuntimeEnvAlias(env, 'CODEXWINMUX_RUNTIME_TERMINAL_V2_MODE'),
  });

export const shouldCreateTerminalTabInRuntimeV2 = (
  options: IShouldCreateTerminalTabInRuntimeV2Options = {},
): boolean => {
  const runtimeV2Enabled = hasOwnRuntimeOption(options, 'runtimeV2Enabled')
    ? options.runtimeV2Enabled
    : isRuntimeV2Enabled();
  const terminalMode = hasOwnRuntimeOption(options, 'terminalMode')
    ? options.terminalMode
    : readRuntimeEnvAlias(process.env, 'CODEXWINMUX_RUNTIME_TERMINAL_V2_MODE');
  const explicitOptIn = options.explicitOptIn ?? false;
  if (!runtimeV2Enabled) return false;
  const mode = resolveRuntimeTerminalV2Mode({ runtimeV2Enabled, terminalMode });
  if (mode === 'new-tabs' || mode === 'default') return true;
  if (mode === 'opt-in') return explicitOptIn;
  return false;
};

export const resolveTabRuntimeVersion = (tab: { runtimeVersion?: unknown }): TRuntimeVersion =>
  tab.runtimeVersion === 2 ? 2 : 1;
