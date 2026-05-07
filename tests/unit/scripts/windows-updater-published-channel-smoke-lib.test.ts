import path from 'path';
import { pathToFileURL } from 'url';
import { describe, expect, it } from 'vitest';

const loadLib = async () =>
  import(pathToFileURL(path.join(process.cwd(), 'scripts/windows-updater-published-channel-smoke-lib.mjs')).href);

describe('Windows updater published channel smoke helpers', () => {
  it('reports a missing GitHub release as a published update blocker', async () => {
    const { evaluateWindowsPublishedUpdateChannel } = await loadLib();

    const result = evaluateWindowsPublishedUpdateChannel({
      releases: [],
      currentVersion: '0.4.2',
    });

    expect(result.ok).toBe(false);
    expect(result.blockers.map((blocker: { ruleId: string }) => blocker.ruleId)).toEqual([
      'windows-published-release-missing',
    ]);
    expect(result.mutatesSystem).toBe(false);
  });

  it('accepts a published release with latest.yml, installer, and blockmap assets', async () => {
    const { evaluateWindowsPublishedUpdateChannel } = await loadLib();

    const result = evaluateWindowsPublishedUpdateChannel({
      currentVersion: '0.4.2',
      latestMetadata: {
        version: '0.4.3',
        path: 'codexmux-Setup-0.4.3.exe',
        sha512: 'installer-sha',
        files: [
          {
            url: 'codexmux-Setup-0.4.3.exe',
            sha512: 'installer-sha',
            size: 123,
          },
        ],
      },
      releases: [
        {
          tag_name: 'v0.4.3',
          draft: false,
          prerelease: false,
          html_url: 'https://github.com/HardcoreMonk/codexmux/releases/tag/v0.4.3',
          assets: [
            {
              name: 'latest.yml',
              size: 345,
              browser_download_url: 'https://github.com/HardcoreMonk/codexmux/releases/download/v0.4.3/latest.yml',
            },
            {
              name: 'codexmux-Setup-0.4.3.exe',
              size: 123,
              browser_download_url: 'https://github.com/HardcoreMonk/codexmux/releases/download/v0.4.3/codexmux-Setup-0.4.3.exe',
            },
            {
              name: 'codexmux-Setup-0.4.3.exe.blockmap',
              size: 456,
              browser_download_url: 'https://github.com/HardcoreMonk/codexmux/releases/download/v0.4.3/codexmux-Setup-0.4.3.exe.blockmap',
            },
          ],
        },
      ],
    });

    expect(result).toMatchObject({
      ok: true,
      currentVersion: '0.4.2',
      latestVersion: '0.4.3',
      latestReleaseTag: 'v0.4.3',
      referencedInstallerName: 'codexmux-Setup-0.4.3.exe',
      blockers: [],
    });
    expect(result.checks).toEqual([
      'windows-published-release-present',
      'windows-published-latest-yml-asset-present',
      'windows-published-version-present',
      'windows-published-version-newer-than-current',
      'windows-published-installer-asset-present',
      'windows-published-installer-size-matches',
      'windows-published-sha512-present',
      'windows-published-blockmap-asset-present',
      'windows-published-download-urls-present',
    ]);
  });

  it('blocks when the published version is not newer than the installed version', async () => {
    const { evaluateWindowsPublishedUpdateChannel } = await loadLib();

    const result = evaluateWindowsPublishedUpdateChannel({
      currentVersion: '0.4.2',
      latestMetadata: {
        version: '0.4.2',
        path: 'codexmux-Setup-0.4.2.exe',
        sha512: 'installer-sha',
        files: [
          {
            url: 'codexmux-Setup-0.4.2.exe',
            sha512: 'installer-sha',
            size: 123,
          },
        ],
      },
      releases: [
        {
          tag_name: 'v0.4.2',
          draft: false,
          prerelease: false,
          assets: [
            { name: 'latest.yml', size: 345, browser_download_url: 'https://example.test/latest.yml' },
            { name: 'codexmux-Setup-0.4.2.exe', size: 123, browser_download_url: 'https://example.test/installer.exe' },
            { name: 'codexmux-Setup-0.4.2.exe.blockmap', size: 456, browser_download_url: 'https://example.test/blockmap' },
          ],
        },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.blockers.map((blocker: { ruleId: string }) => blocker.ruleId)).toContain(
      'windows-published-version-not-newer',
    );
  });

  it('builds a sanitized artifact payload', async () => {
    const { buildWindowsPublishedUpdateArtifactPayload } = await loadLib();

    const payload = buildWindowsPublishedUpdateArtifactPayload({
      ok: false,
      mutatesSystem: false,
      currentVersion: '0.4.2',
      latestVersion: null,
      latestReleaseTag: null,
      releaseCount: 0,
      referencedInstallerName: null,
      latestReleaseUrl: null,
      checks: [],
      blockers: [
        {
          ruleId: 'windows-published-release-missing',
          message: 'No published GitHub release was found.',
        },
      ],
    });

    expect(payload).toEqual({
      ok: false,
      mutatesSystem: false,
      currentVersion: '0.4.2',
      latestVersion: null,
      latestReleaseTag: null,
      latestReleaseUrl: null,
      releaseCount: 0,
      referencedInstallerName: null,
      checks: [],
      blockers: [
        {
          ruleId: 'windows-published-release-missing',
          message: 'No published GitHub release was found.',
        },
      ],
    });
  });

  it('allows the installed version to be overridden for published update evidence', async () => {
    const { resolveWindowsPublishedUpdateCurrentVersion } = await loadLib();

    expect(resolveWindowsPublishedUpdateCurrentVersion({
      env: { CODEXMUX_WINDOWS_UPDATER_CURRENT_VERSION: '0.4.2' },
      packageVersion: '0.4.8',
    })).toBe('0.4.2');
    expect(resolveWindowsPublishedUpdateCurrentVersion({
      env: {},
      packageVersion: '0.4.8',
    })).toBe('0.4.8');
  });
});
