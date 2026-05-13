import { describe, expect, it } from 'vitest';
import path from 'path';
import { pathToFileURL } from 'url';

const loadLib = async () =>
  import(pathToFileURL(path.join(process.cwd(), 'scripts/windows-runtime-v2-terminal-smoke-lib.ts')).href);

describe('Windows runtime v2 terminal smoke helpers', () => {
  it('builds an echo command that works in cmd.exe', async () => {
    const { buildWindowsRuntimeSmokeEchoCommand } = await loadLib();

    expect(buildWindowsRuntimeSmokeEchoCommand('cmux-marker')).toBe('echo cmux-marker\r');
  });

  it('detects smoke markers after terminal control sequences are stripped', async () => {
    const { hasWindowsRuntimeSmokeMarker } = await loadLib();

    expect(hasWindowsRuntimeSmokeMarker('\u001b[?25hcmux-marker\r\n', 'cmux-marker')).toBe(true);
    expect(hasWindowsRuntimeSmokeMarker('other output', 'cmux-marker')).toBe(false);
  });

  it('builds a Windows runtime v2 smoke environment', async () => {
    const { createWindowsRuntimeV2TerminalSmokeEnv } = await loadLib();
    const env = createWindowsRuntimeV2TerminalSmokeEnv({
      env: { PATH: 'C:\\Windows\\System32' },
      homeDir: 'C:\\Temp\\codexmux-home',
      dbPath: 'C:\\Temp\\codexmux-home\\runtime-v2\\state.db',
      shell: 'C:\\Windows\\System32\\cmd.exe',
    });

    expect(env).toMatchObject({
      PATH: 'C:\\Windows\\System32',
      HOME: 'C:\\Temp\\codexmux-home',
      USERPROFILE: 'C:\\Temp\\codexmux-home',
      CODEXWINMUX_RUNTIME_V2: '1',
      CODEXWINMUX_RUNTIME_DB: 'C:\\Temp\\codexmux-home\\runtime-v2\\state.db',
      CODEXWINMUX_RUNTIME_TERMINAL_ADAPTER: 'windows',
      CODEXMUX_WINDOWS_SHELL: 'C:\\Windows\\System32\\cmd.exe',
    });
    expect(JSON.parse(env.__CMUX_PRISTINE_ENV)).toMatchObject({
      CODEXWINMUX_RUNTIME_TERMINAL_ADAPTER: 'windows',
    });
  });
});
