import path from 'path';
import { pathToFileURL } from 'url';
import { describe, expect, it } from 'vitest';

const loadLib = async () =>
  import(pathToFileURL(path.join(process.cwd(), 'scripts/dev-lan-lib.mjs')).href);

describe('LAN dev server script helpers', () => {
  it('builds the Windows invocation without cmd shims', async () => {
    const { buildLanDevServerInvocation } = await loadLib();

    const invocation = buildLanDevServerInvocation({
      platform: 'win32',
      nodePath: 'C:\\Program Files\\nodejs\\node.exe',
      env: {},
    });

    expect(invocation.command).toBe('C:\\Program Files\\nodejs\\node.exe');
    expect(invocation.args).toEqual([
      path.join('C:\\Program Files\\nodejs', 'node_modules', 'corepack', 'dist', 'corepack.js'),
      'pnpm',
      'dev',
    ]);
    expect(invocation.args.join(' ')).not.toContain('cmd.exe');
    expect(invocation.args.join(' ')).not.toContain('corepack.cmd');
  });

  it('forces canonical CODEXWINMUX runtime env for a Windows LAN dev server', async () => {
    const { buildLanDevServerEnv } = await loadLib();

    const env = buildLanDevServerEnv({
      platform: 'win32',
      env: {
        PATH: 'C:\\Windows\\System32',
        HOST: '',
        PORT: '',
        CODEXMUX_RUNTIME_V2: '0',
        CODEXMUX_RUNTIME_TERMINAL_ADAPTER: 'tmux',
        CODEXMUX_PROCESS_INSPECTOR_ADAPTER: 'tmux',
        CODEXWINMUX_RUNTIME_TERMINAL_ADAPTER: 'tmux',
      },
    });

    expect(env.HOST).toBe('0.0.0.0');
    expect(env.PORT).toBe('8121');
    expect(env.CODEXWINMUX_RUNTIME_V2).toBe('1');
    expect(env.CODEXWINMUX_RUNTIME_STORAGE_V2_MODE).toBe('default');
    expect(env.CODEXWINMUX_RUNTIME_TERMINAL_V2_MODE).toBe('new-tabs');
    expect(env.CODEXWINMUX_RUNTIME_TERMINAL_ADAPTER).toBe('windows');
    expect(env.CODEXWINMUX_RUNTIME_TIMELINE_V2_MODE).toBe('default');
    expect(env.CODEXWINMUX_RUNTIME_STATUS_V2_MODE).toBe('default');
    expect(env.CODEXWINMUX_PROCESS_INSPECTOR_ADAPTER).toBe('windows');
    expect(env.CODEXMUX_RUNTIME_V2).toBeUndefined();
    expect(env.CODEXMUX_RUNTIME_TERMINAL_ADAPTER).toBeUndefined();
    expect(env.CODEXMUX_PROCESS_INSPECTOR_ADAPTER).toBeUndefined();
  });
});
