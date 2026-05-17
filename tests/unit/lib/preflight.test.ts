import { describe, expect, it } from 'vitest';

import {
  buildWindowsToolSearchPath,
  createTerminalRuntimePreflightStatus,
  parseToolSemanticVersion,
} from '@/lib/preflight';
import {
  isRuntimeOk,
  readRuntimeAgentStatus,
  readRuntimeTerminalName,
  readRuntimeTerminalStatus,
} from '@/types/preflight';
import type { IRuntimePreflightResult } from '@/types/preflight';

const readyBase = {
  tmux: { installed: true, compatible: true, version: '3.4' },
  git: { installed: true, version: '2.44.0' },
};

describe('preflight agent status', () => {
  it('uses the Codex agent runtime status', () => {
    const status: IRuntimePreflightResult = {
      ...readyBase,
      agent: { installed: true, version: '0.12.0' },
    };

    expect(readRuntimeAgentStatus(status)).toEqual(status.agent);
    expect(isRuntimeOk(status)).toBe(true);
  });

  it('fails runtime readiness when the Codex agent is missing', () => {
    const status: IRuntimePreflightResult = {
      ...readyBase,
      agent: { installed: false, version: null },
    };

    expect(readRuntimeAgentStatus(status)).toEqual(status.agent);
    expect(isRuntimeOk(status)).toBe(false);
  });

  it('accepts the Windows terminal runtime instead of requiring tmux on win32', () => {
    const status: IRuntimePreflightResult = {
      platform: 'win32',
      tmux: { installed: false, compatible: false, version: null },
      terminalRuntime: {
        adapter: 'windows',
        installed: true,
        compatible: true,
        version: null,
      },
      git: { installed: true, version: '2.44.0' },
      agent: { installed: true, version: '0.12.0' },
    };

    expect(readRuntimeTerminalStatus(status)).toEqual(status.terminalRuntime);
    expect(readRuntimeTerminalName(status)).toBe('Windows Terminal Runtime');
    expect(isRuntimeOk(status)).toBe(true);
  });

  it('fails Windows runtime readiness when the terminal runtime is unavailable', () => {
    const status: IRuntimePreflightResult = {
      platform: 'win32',
      tmux: { installed: false, compatible: false, version: null },
      terminalRuntime: {
        adapter: 'windows',
        installed: false,
        compatible: false,
        version: null,
      },
      git: { installed: true, version: '2.44.0' },
      agent: { installed: true, version: '0.12.0' },
    };

    expect(isRuntimeOk(status)).toBe(false);
  });

  it('builds platform terminal runtime status without changing the tmux compatibility field', () => {
    const missingTmux = { installed: false, compatible: false, version: null };
    const readyTmux = { installed: true, compatible: true, version: '3.4' };

    expect(createTerminalRuntimePreflightStatus({
      platform: 'win32',
      tmux: missingTmux,
    })).toEqual({
      adapter: 'windows',
      installed: true,
      compatible: true,
      version: null,
    });

    expect(createTerminalRuntimePreflightStatus({
      platform: 'linux',
      tmux: readyTmux,
    })).toEqual({
      adapter: 'tmux',
      installed: true,
      compatible: true,
      version: '3.4',
    });
  });

  it('parses semantic versions without trailing punctuation', () => {
    expect(parseToolSemanticVersion('git version 2.54.0.windows.1')).toBe('2.54.0');
    expect(parseToolSemanticVersion('codex-cli 0.128.0')).toBe('0.128.0');
    expect(parseToolSemanticVersion('tmux 3.4')).toBe('3.4');
  });

  it('adds service-profile tool locations to the Windows search path', () => {
    const searchPath = buildWindowsToolSearchPath({
      basePath: 'C:\\Windows\\System32',
      env: {
        APPDATA: 'C:\\ProgramData\\codexwinmux\\service-profile\\AppData\\Roaming',
        LOCALAPPDATA: 'C:\\ProgramData\\codexwinmux\\service-profile\\AppData\\Local',
        USERPROFILE: 'C:\\ProgramData\\codexwinmux\\service-profile',
      },
    });

    expect(searchPath.split(';')).toEqual(expect.arrayContaining([
      'C:\\Windows\\System32',
      'C:\\ProgramData\\codexwinmux\\service-profile\\AppData\\Roaming\\npm',
      'C:\\ProgramData\\codexwinmux\\service-profile\\AppData\\Local\\Microsoft\\WinGet\\Links',
      'C:\\ProgramData\\codexwinmux\\service-profile\\.local\\bin',
    ]));
  });
});
