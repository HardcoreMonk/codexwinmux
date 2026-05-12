import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('isAllowedJsonlPath', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('allows local Codex session JSONL paths', async () => {
    const home = path.join(os.tmpdir(), 'codexmux-path-validation-local');
    vi.stubEnv('HOME', home);

    const { isAllowedJsonlPath } = await import('@/lib/path-validation');

    expect(isAllowedJsonlPath(
      path.join(home, '.codex', 'sessions', '2026', '05', '05', 'session.jsonl'),
      { homeDir: home },
    )).toBe(true);
  });

  it('rejects legacy remote Codex JSONL paths', async () => {
    const home = path.join(os.tmpdir(), 'codexmux-path-validation-remote');
    vi.stubEnv('HOME', home);

    const { isAllowedJsonlPath } = await import('@/lib/path-validation');

    expect(isAllowedJsonlPath(
      path.join(home, '.codexwinmux', 'remote', 'codex', 'win11', 'session.jsonl'),
      { homeDir: home },
    )).toBe(false);
  });

  it('allows Windows Codex session JSONL paths with an injected home directory', async () => {
    const { isAllowedJsonlPath } = await import('@/lib/path-validation');

    expect(isAllowedJsonlPath(
      'C:\\Users\\yohan\\.codex\\sessions\\2026\\05\\06\\session.jsonl',
      { homeDir: 'C:\\Users\\yohan' },
    )).toBe(true);
  });

  it('rejects Windows sibling directories that only share the sessions prefix', async () => {
    const { isAllowedJsonlPath } = await import('@/lib/path-validation');

    expect(isAllowedJsonlPath(
      'C:\\Users\\yohan\\.codex\\sessions-backup\\session.jsonl',
      { homeDir: 'C:\\Users\\yohan' },
    )).toBe(false);
  });

  it('rejects Windows legacy remote Codex sidecar paths', async () => {
    const { isAllowedJsonlPath } = await import('@/lib/path-validation');

    expect(isAllowedJsonlPath(
      'C:\\Users\\yohan\\.codexwinmux\\remote\\codex\\win11\\session.jsonl',
      { homeDir: 'C:\\Users\\yohan' },
    )).toBe(false);
  });
});
