import path from 'path';
import { pathToFileURL } from 'url';
import { describe, expect, it } from 'vitest';

const loadLib = async () =>
  import(pathToFileURL(path.join(process.cwd(), 'scripts/windows-updater-local-feed-smoke-lib.mjs')).href);

describe('Windows updater local feed smoke helpers', () => {
  it('bumps the patch version for a synthetic local feed update', async () => {
    const { bumpPatchVersion } = await loadLib();

    expect(bumpPatchVersion('0.4.2')).toBe('0.4.3');
    expect(bumpPatchVersion('10.20.30')).toBe('10.20.31');
    expect(() => bumpPatchVersion('not-semver')).toThrow('valid x.y.z version');
  });

  it('builds latest.yml metadata for a local feed without changing installer checksums', async () => {
    const { buildWindowsUpdaterLocalFeedLatestMetadata } = await loadLib();

    const latest = buildWindowsUpdaterLocalFeedLatestMetadata({
      latestMetadata: {
        version: '0.4.2',
        files: [
          {
            url: 'codexwinmux-Setup-0.4.2.exe',
            sha512: 'installer-sha',
            size: 123,
          },
        ],
        path: 'codexwinmux-Setup-0.4.2.exe',
        sha512: 'installer-sha',
        releaseDate: '2026-05-06T17:00:33.564Z',
      },
      nextVersion: '0.4.3',
      releaseDate: '2026-05-07T00:00:00.000Z',
    });

    expect(latest).toEqual({
      version: '0.4.3',
      files: [
        {
          url: 'codexwinmux-Setup-0.4.2.exe',
          sha512: 'installer-sha',
          size: 123,
        },
      ],
      path: 'codexwinmux-Setup-0.4.2.exe',
      sha512: 'installer-sha',
      releaseDate: '2026-05-07T00:00:00.000Z',
    });
  });

  it('builds the packaged app updater smoke environment', async () => {
    const { buildWindowsUpdaterSmokeEnv } = await loadLib();

    const env = buildWindowsUpdaterSmokeEnv({
      env: { PATH: 'C:\\Windows' },
      feedUrl: 'http://127.0.0.1:8123/',
      statusPath: 'C:\\tmp\\updater-status.jsonl',
      installDir: 'C:\\tmp\\codexmux-app',
      homeDir: 'C:\\tmp\\codexmux-home',
    });

    expect(env).toMatchObject({
      PATH: 'C:\\Windows',
      HOME: 'C:\\tmp\\codexmux-home',
      USERPROFILE: 'C:\\tmp\\codexmux-home',
      APPDATA: 'C:\\tmp\\codexmux-home\\AppData\\Roaming',
      LOCALAPPDATA: 'C:\\tmp\\codexmux-home\\AppData\\Local',
      CODEXMUX_ELECTRON_UPDATER_FEED_URL: 'http://127.0.0.1:8123/',
      CODEXMUX_ELECTRON_UPDATER_SMOKE: '1',
      CODEXMUX_ELECTRON_UPDATER_SMOKE_STATUS_PATH: 'C:\\tmp\\updater-status.jsonl',
      CODEXMUX_ELECTRON_UPDATER_SMOKE_AUTO_DOWNLOAD: '1',
      CODEXMUX_ELECTRON_UPDATER_SMOKE_AUTO_INSTALL: '1',
      CODEXMUX_ELECTRON_UPDATER_SMOKE_INSTALL_DIR: 'C:\\tmp\\codexmux-app',
      CODEXMUX_ELECTRON_UPDATER_DISABLE_DIFFERENTIAL: '1',
      ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
      ELECTRON_DISABLE_SANDBOX: '1',
    });
  });

  it('summarizes updater status events into checks', async () => {
    const { summarizeWindowsUpdaterStatusEvents } = await loadLib();

    const summary = summarizeWindowsUpdaterStatusEvents([
      { event: 'configured', feedProvider: 'generic' },
      { event: 'checking-for-update' },
      { event: 'update-available', version: '0.4.3' },
      { event: 'download-started', version: '0.4.3' },
      { event: 'download-progress', percent: 100 },
      { event: 'update-downloaded', version: '0.4.3', downloadedFileName: 'codexwinmux-Setup-0.4.2.exe' },
      { event: 'quit-and-install-started', version: '0.4.3' },
    ]);

    expect(summary).toEqual({
      ok: true,
      latestVersion: '0.4.3',
      downloadedFileName: 'codexwinmux-Setup-0.4.2.exe',
      checks: [
        'updater-local-feed-configured',
        'updater-check-started',
        'updater-update-available',
        'updater-download-started',
        'updater-download-progress',
        'updater-update-downloaded',
        'updater-quit-and-install-started',
      ],
      blockers: [],
    });
  });

  it('reports missing updater install events as blockers', async () => {
    const { summarizeWindowsUpdaterStatusEvents } = await loadLib();

    const summary = summarizeWindowsUpdaterStatusEvents([
      { event: 'configured', feedProvider: 'generic' },
      { event: 'checking-for-update' },
      { event: 'update-available', version: '0.4.3' },
    ]);

    expect(summary.ok).toBe(false);
    expect(summary.blockers.map((blocker: { ruleId: string }) => blocker.ruleId)).toEqual([
      'updater-download-started-missing',
      'updater-update-downloaded-missing',
      'updater-quit-and-install-started-missing',
    ]);
  });
});
