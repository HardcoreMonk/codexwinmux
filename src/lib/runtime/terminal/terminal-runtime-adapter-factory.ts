import type { ITerminalRuntimeAdapter } from '@/lib/runtime/terminal/terminal-runtime-contract';
import { createTerminalWorkerRuntime } from '@/lib/runtime/terminal/terminal-worker-runtime';
import { createWindowsTerminalRuntime } from '@/lib/runtime/terminal/windows-terminal-runtime';
import { readRuntimeEnvAlias } from '@/lib/runtime/env';

export type TTerminalRuntimeAdapterKind = 'tmux' | 'windows';

export interface ITerminalRuntimeAdapterFactoryEnv {
  [key: string]: string | undefined;
  CODEXWINMUX_RUNTIME_TERMINAL_ADAPTER?: string;
  CODEXMUX_RUNTIME_TERMINAL_ADAPTER?: string;
}

export interface IResolveTerminalRuntimeAdapterKindOptions {
  env?: ITerminalRuntimeAdapterFactoryEnv;
  platform?: NodeJS.Platform;
}

export interface ICreateTerminalRuntimeAdapterOptions extends IResolveTerminalRuntimeAdapterKindOptions {
  createTmuxRuntime?: () => ITerminalRuntimeAdapter;
  createWindowsRuntime?: () => ITerminalRuntimeAdapter;
}

const createUnsupportedTerminalAdapterError = (value: string): Error & {
  code: string;
  retryable: false;
} => Object.assign(
  new Error(`Unsupported runtime v2 terminal adapter: ${value}`),
  {
    code: 'runtime-v2-terminal-adapter-unsupported',
    retryable: false as const,
  },
);

export const resolveTerminalRuntimeAdapterKind = ({
  env = process.env,
}: IResolveTerminalRuntimeAdapterKindOptions = {}): TTerminalRuntimeAdapterKind => {
  const value = readRuntimeEnvAlias(env, 'CODEXMUX_RUNTIME_TERMINAL_ADAPTER')?.trim().toLowerCase();
  if (!value || value === 'tmux') return 'tmux';
  if (value === 'windows') return 'windows';
  throw createUnsupportedTerminalAdapterError(value);
};

export const createTerminalRuntimeAdapter = ({
  createTmuxRuntime = createTerminalWorkerRuntime,
  createWindowsRuntime = createWindowsTerminalRuntime,
  ...options
}: ICreateTerminalRuntimeAdapterOptions = {}): ITerminalRuntimeAdapter => {
  const kind = resolveTerminalRuntimeAdapterKind(options);
  if (kind === 'tmux') return createTmuxRuntime();
  if (kind === 'windows') return createWindowsRuntime();
  throw createUnsupportedTerminalAdapterError(kind);
};
