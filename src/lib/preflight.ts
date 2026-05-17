import { execFile as execFileCb } from 'child_process';
import { access } from 'fs/promises';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import type {
  IPreflightResult,
  IRuntimePreflightResult,
  TTerminalRuntimePreflightStatus,
} from '@/types/preflight';
import { buildShellEnv, defaultShell as resolveDefaultShell } from '@/lib/shell-env';
import { PRISTINE_ENV } from '@/lib/pristine-env';

const execFile = promisify(execFileCb);
const CMD_TIMEOUT = 5000;

let shellPathCache: string | null = null;
let shellPathPromise: Promise<string> | null = null;

const defaultShell = () => os.userInfo().shell || resolveDefaultShell();

const appendUniquePath = (paths: string[], value: string | undefined | null): void => {
  if (!value) return;
  for (const entry of value.split(path.win32.delimiter)) {
    const trimmed = entry.trim();
    if (trimmed && !paths.some((existing) => existing.toLowerCase() === trimmed.toLowerCase())) {
      paths.push(trimmed);
    }
  }
};

const appendUniqueDir = (paths: string[], value: string | undefined | null): void => {
  if (!value) return;
  const trimmed = value.trim();
  if (trimmed && !paths.some((existing) => existing.toLowerCase() === trimmed.toLowerCase())) {
    paths.push(trimmed);
  }
};

export const buildWindowsToolSearchPath = ({
  env = process.env,
  basePath,
}: {
  env?: Record<string, string | undefined>;
  basePath?: string;
} = {}): string => {
  const paths: string[] = [];
  appendUniquePath(paths, basePath);
  appendUniquePath(paths, env.PATH);
  appendUniquePath(paths, env.Path);
  appendUniquePath(paths, PRISTINE_ENV.PATH);
  appendUniquePath(paths, PRISTINE_ENV.Path);

  appendUniqueDir(paths, env.CODEXWINMUX_CODEX_CLI_DIR);
  if (env.CODEXWINMUX_CODEX_CLI_PATH) {
    appendUniqueDir(paths, path.win32.dirname(env.CODEXWINMUX_CODEX_CLI_PATH));
  }
  if (env.APPDATA) {
    appendUniqueDir(paths, path.win32.join(env.APPDATA, 'npm'));
  }
  if (env.LOCALAPPDATA) {
    appendUniqueDir(paths, path.win32.join(env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links'));
  }
  if (env.USERPROFILE) {
    appendUniqueDir(paths, path.win32.join(env.USERPROFILE, '.local', 'bin'));
  }

  return paths.join(path.win32.delimiter);
};

const resolveShellPathAsync = async (): Promise<string> => {
  if (process.platform === 'win32') {
    return buildWindowsToolSearchPath({
      basePath: process.env.PATH || process.env.Path || PRISTINE_ENV.PATH || '',
    });
  }

  const shell = defaultShell();
  try {
    const { stdout } = await execFile(shell, ['-ilc', 'echo -n "$PATH"'], {
      timeout: CMD_TIMEOUT,
      env: {
        ...buildShellEnv(),
        SHELL: shell,
        DISABLE_AUTO_UPDATE: 'true',
        ZSH_TMUX_AUTOSTARTED: 'true',
      },
    });
    return stdout.toString().trim();
  } catch {
    return PRISTINE_ENV.PATH || '';
  }
};

export const initShellPath = async (): Promise<void> => {
  shellPathCache = await resolveShellPathAsync();
};

export const getShellPath = async (): Promise<string> => {
  if (shellPathCache) return shellPathCache;
  if (!shellPathPromise) {
    shellPathPromise = resolveShellPathAsync().then((result) => {
      shellPathCache = result;
      shellPathPromise = null;
      return result;
    });
  }
  return shellPathPromise;
};
const MIN_TMUX_VERSION = 2.9;

interface IToolStatus {
  installed: boolean;
  version: string | null;
}

const checkTool = async (
  cmd: string,
  args: string[],
  parseVersion: (stdout: string) => string | null,
): Promise<IToolStatus> => {
  try {
    const resolvedPath = await getShellPath();
    const { stdout } = await execTool(cmd, args, resolvedPath);
    return { installed: true, version: parseVersion(stdout) };
  } catch {
    return { installed: false, version: null };
  }
};

const psQuote = (value: string): string =>
  `'${value.replace(/'/g, "''")}'`;

const execTool = async (
  cmd: string,
  args: string[],
  resolvedPath: string,
): Promise<{ stdout: string }> => {
  const env = { ...process.env, PATH: resolvedPath, Path: resolvedPath };
  try {
    return await execFile(cmd, args, { timeout: CMD_TIMEOUT, env });
  } catch (err) {
    if (process.platform !== 'win32') throw err;

    const command = [
      "$ErrorActionPreference = 'Stop'",
      `[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)`,
      `& ${psQuote(cmd)} ${args.map(psQuote).join(' ')}`,
    ].join('; ');
    return execFile('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      command,
    ], {
      timeout: CMD_TIMEOUT,
      env,
      windowsHide: true,
    });
  }
};

export const parseToolSemanticVersion = (stdout: string): string | null =>
  stdout.trim().match(/(\d+(?:\.\d+)+)/)?.[1] ?? null;

const CODEX_KNOWN_DIRS = [path.join(os.homedir(), '.local', 'bin')];

const findCodexBinary = async (): Promise<string | null> => {
  for (const dir of CODEX_KNOWN_DIRS) {
    try {
      await access(path.join(dir, 'codex'));
      return dir;
    } catch {
      // not found
    }
  }
  return null;
};

const isTmuxCompatible = (tool: IToolStatus): boolean =>
  tool.installed && tool.version !== null && parseFloat(tool.version) >= MIN_TMUX_VERSION;

export const createTerminalRuntimePreflightStatus = ({
  platform,
  tmux,
}: {
  platform: NodeJS.Platform;
  tmux: IToolStatus & { compatible: boolean };
}): TTerminalRuntimePreflightStatus => {
  if (platform === 'win32') {
    return {
      adapter: 'windows',
      installed: true,
      compatible: true,
      version: null,
    };
  }

  return {
    ...tmux,
    adapter: 'tmux',
  };
};

const checkClt = async (): Promise<{ installed: boolean }> => {
  try {
    await execFile('xcode-select', ['-p'], { timeout: CMD_TIMEOUT });
    return { installed: true };
  } catch {
    return { installed: false };
  }
};

export const getPreflightStatus = async (): Promise<IPreflightResult> => {
  shellPathCache = await resolveShellPathAsync();
  const platform = process.platform;
  const [tmux, git, codex] = await Promise.all([
    platform === 'win32'
      ? Promise.resolve({ installed: false, version: null })
      : checkTool('tmux', ['-V'], parseToolSemanticVersion),
    checkTool('git', ['--version'], parseToolSemanticVersion),
    checkTool('codex', ['--version'], parseToolSemanticVersion),
  ]);

  const tmuxStatus = { ...tmux, compatible: isTmuxCompatible(tmux) };
  const terminalRuntime = createTerminalRuntimePreflightStatus({ platform, tmux: tmuxStatus });
  const coreReady = terminalRuntime.installed && terminalRuntime.compatible && git.installed && codex.installed;

  const codexBinaryPath = codex.installed ? null : await findCodexBinary();
  let codexLoggedIn = false;
  if (codex.installed || codexBinaryPath) {
    try {
      await access(path.join(os.homedir(), '.codex'));
      codexLoggedIn = true;
    } catch {
      // not logged in yet
    }
  }

  const codexStatus = { ...codex, binaryPath: codexBinaryPath, loggedIn: codexLoggedIn };
  const result: IPreflightResult = {
    platform,
    tmux: tmuxStatus,
    terminalRuntime,
    git,
    agent: codexStatus,
  };

  if (!coreReady) {
    if (process.platform === 'darwin') {
      const [brew, clt] = await Promise.all([
        checkTool('brew', ['--version'], parseToolSemanticVersion),
        checkClt(),
      ]);
      result.brew = brew;
      result.clt = clt;
    }
  }

  return result;
};

const RUNTIME_CACHE_TTL = 30_000;
let runtimeCache: { result: IRuntimePreflightResult; checkedAt: number } | null = null;
let inflightRequest: Promise<IRuntimePreflightResult> | null = null;

const PREFLIGHT_CACHE_TTL = 1_000;
let preflightCache: { result: IPreflightResult; checkedAt: number } | null = null;
let preflightInflight: Promise<IPreflightResult> | null = null;

export const getCachedPreflightStatus = async (): Promise<IPreflightResult> => {
  if (preflightCache && Date.now() - preflightCache.checkedAt < PREFLIGHT_CACHE_TTL) {
    return preflightCache.result;
  }
  if (preflightInflight) return preflightInflight;

  preflightInflight = getPreflightStatus()
    .then((result) => {
      preflightCache = { result, checkedAt: Date.now() };
      preflightInflight = null;
      return result;
    })
    .catch((err) => {
      preflightInflight = null;
      throw err;
    });

  return preflightInflight;
};

export const getRuntimePreflightStatus = async (): Promise<IRuntimePreflightResult> => {
  shellPathCache = await resolveShellPathAsync();
  const platform = process.platform;
  const [tmux, git, codex] = await Promise.all([
    platform === 'win32'
      ? Promise.resolve({ installed: false, version: null })
      : checkTool('tmux', ['-V'], parseToolSemanticVersion),
    checkTool('git', ['--version'], parseToolSemanticVersion),
    checkTool('codex', ['--version'], parseToolSemanticVersion),
  ]);
  const tmuxStatus = { ...tmux, compatible: isTmuxCompatible(tmux) };

  return {
    platform,
    tmux: tmuxStatus,
    terminalRuntime: createTerminalRuntimePreflightStatus({ platform, tmux: tmuxStatus }),
    git,
    agent: codex,
  };
};

export const getCachedRuntimePreflight = async (): Promise<IRuntimePreflightResult> => {
  if (runtimeCache && Date.now() - runtimeCache.checkedAt < RUNTIME_CACHE_TTL) {
    return runtimeCache.result;
  }
  if (inflightRequest) return inflightRequest;

  inflightRequest = getRuntimePreflightStatus()
    .then((result) => {
      runtimeCache = { result, checkedAt: Date.now() };
      inflightRequest = null;
      return result;
    })
    .catch((err) => {
      inflightRequest = null;
      throw err;
    });

  return inflightRequest;
};

export const invalidateRuntimeCache = (): void => {
  runtimeCache = null;
  inflightRequest = null;
};
