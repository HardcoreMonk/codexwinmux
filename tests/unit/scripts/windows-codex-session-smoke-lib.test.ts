import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  buildSyntheticCodexProcessArgs,
  buildWindowsCodexSessionJsonl,
  buildWindowsCodexSessionJsonlPath,
  createWindowsCodexSessionSmokeEnv,
} from '../../../scripts/windows-codex-session-smoke-lib';

const sessionId = '019dd56a-e200-7890-a1a4-4a7cad2fe112';
const startedAt = '2026-05-06T12:00:00.000Z';

describe('windows codex session smoke helpers', () => {
  it('builds a Codex-shaped child process command line', () => {
    expect(buildSyntheticCodexProcessArgs(sessionId)).toEqual([
      '-e',
      'setInterval(() => {}, 1000)',
      'codex',
      sessionId,
    ]);
  });

  it('builds a Windows temp session JSONL path with a Codex UUID basename', () => {
    expect(buildWindowsCodexSessionJsonlPath({
      homeDir: 'C:\\Temp\\cmux-smoke',
      sessionId,
      startedAt,
    })).toBe(path.join(
      'C:\\Temp\\cmux-smoke',
      '.codex',
      'sessions',
      '2026',
      '05',
      '06',
      `rollout-2026-05-06T12-00-00-${sessionId}.jsonl`,
    ));
  });

  it('writes session_meta and turn_context records for JSONL mapping', () => {
    const jsonl = buildWindowsCodexSessionJsonl({
      sessionId,
      cwd: 'D:\\work\\project',
      startedAt,
    });

    const records = jsonl.split('\n').map((line) => JSON.parse(line) as {
      type: string;
      payload: Record<string, unknown>;
    });

    expect(records).toEqual([
      {
        timestamp: startedAt,
        type: 'session_meta',
        payload: {
          id: sessionId,
          timestamp: startedAt,
          cwd: 'D:\\work\\project',
        },
      },
      {
        timestamp: startedAt,
        type: 'turn_context',
        payload: {
          cwd: 'D:\\work\\project',
        },
      },
    ]);
  });

  it('creates a Windows process inspector smoke environment', () => {
    expect(createWindowsCodexSessionSmokeEnv({
      env: { ...process.env, PATH: 'C:\\Windows\\System32' },
      homeDir: 'C:\\Temp\\cmux-smoke',
    })).toMatchObject({
      PATH: 'C:\\Windows\\System32',
      HOME: 'C:\\Temp\\cmux-smoke',
      USERPROFILE: 'C:\\Temp\\cmux-smoke',
      CODEXWINMUX_PROCESS_INSPECTOR_ADAPTER: 'windows',
      CODEXMUX_PROCESS_INSPECTOR_ADAPTER: 'windows',
    });
  });
});
