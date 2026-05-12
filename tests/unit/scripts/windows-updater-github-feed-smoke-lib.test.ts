import path from 'path';
import { pathToFileURL } from 'url';
import { describe, expect, it } from 'vitest';

const loadLib = async () =>
  import(pathToFileURL(path.join(process.cwd(), 'scripts/windows-updater-github-feed-smoke-lib.mjs')).href);

describe('Windows updater GitHub feed smoke helpers', () => {
  it('builds a GitHub-hosted generic updater feed URL for a release tag', async () => {
    const { buildWindowsUpdaterGitHubFeedUrl } = await loadLib();

    expect(buildWindowsUpdaterGitHubFeedUrl({
      owner: 'HardcoreMonk',
      repo: 'codexwinmux',
      tag: 'v0.4.8',
    })).toBe('https://github.com/HardcoreMonk/codexwinmux/releases/download/v0.4.8/');
  });

  it('requires owner, repo, and tag for the GitHub feed URL', async () => {
    const { buildWindowsUpdaterGitHubFeedUrl } = await loadLib();

    expect(() => buildWindowsUpdaterGitHubFeedUrl({ owner: '', repo: 'codexwinmux', tag: 'v0.4.8' }))
      .toThrow('owner');
    expect(() => buildWindowsUpdaterGitHubFeedUrl({ owner: 'HardcoreMonk', repo: '', tag: 'v0.4.8' }))
      .toThrow('repo');
    expect(() => buildWindowsUpdaterGitHubFeedUrl({ owner: 'HardcoreMonk', repo: 'codexwinmux', tag: '' }))
      .toThrow('tag');
  });

  it('builds a path-light full updater artifact payload', async () => {
    const { buildWindowsUpdaterGitHubFeedArtifactPayload } = await loadLib();

    const payload = buildWindowsUpdaterGitHubFeedArtifactPayload({
      ok: true,
      checks: ['base-installer-present', 'github-feed-url', 'silent-install'],
      statusSummary: {
        latestVersion: '0.4.8',
        downloadedFileName: 'codexwinmux-Setup-0.4.8.exe',
        blockers: [],
      },
      installResult: { exitCode: 0, signal: null, timedOut: false, stdout: 'drop me' },
      updateLaunchResult: { exitCode: 0, signal: null, timedOut: false, stderr: 'drop me' },
      postInstallLaunchResult: { exitCode: 0, signal: null, timedOut: false },
      uninstallResult: { exitCode: 0, signal: null, timedOut: false },
    });

    expect(payload).toEqual({
      ok: true,
      mutatesSystem: true,
      checks: ['base-installer-present', 'github-feed-url', 'silent-install'],
      blockers: [],
      latestVersion: '0.4.8',
      downloadedFileName: 'codexwinmux-Setup-0.4.8.exe',
      installResult: { exitCode: 0, signal: null, timedOut: false },
      updateLaunchResult: { exitCode: 0, signal: null, timedOut: false },
      postInstallLaunchResult: { exitCode: 0, signal: null, timedOut: false },
      uninstallResult: { exitCode: 0, signal: null, timedOut: false },
    });
    expect(JSON.stringify(payload)).not.toContain('drop me');
  });
});
