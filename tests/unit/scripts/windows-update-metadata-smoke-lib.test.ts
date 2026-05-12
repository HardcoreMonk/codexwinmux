import path from 'path';
import { pathToFileURL } from 'url';
import { describe, expect, it } from 'vitest';

const loadLib = async () =>
  import(pathToFileURL(path.join(process.cwd(), 'scripts/windows-update-metadata-smoke-lib.mjs')).href);

describe('Windows update metadata smoke helpers', () => {
  it('reports a blocker when latest.yml references an installer missing from release', async () => {
    const { evaluateWindowsUpdateMetadata } = await loadLib();

    const result = evaluateWindowsUpdateMetadata({
      latestMetadata: {
        version: '0.4.2',
        path: 'codexwinmux-Setup-0.4.2.exe',
        sha512: 'installer-sha',
        files: [
          {
            url: 'codexwinmux-Setup-0.4.2.exe',
            sha512: 'installer-sha',
            size: 123,
          },
        ],
      },
      appUpdateMetadata: {
        provider: 'github',
        owner: 'HardcoreMonk',
        repo: 'codexwinmux',
        updaterCacheDirName: 'codexwinmux-updater',
      },
      publishConfig: {
        provider: 'github',
        owner: 'HardcoreMonk',
        repo: 'codexwinmux',
      },
      releaseFiles: [
        { name: 'codexwinmux Setup 0.4.2.exe', size: 123 },
        { name: 'codexwinmux Setup 0.4.2.exe.blockmap', size: 12 },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.referencedInstallerName).toBe('codexwinmux-Setup-0.4.2.exe');
    expect(result.blockers.map((blocker: { ruleId: string }) => blocker.ruleId)).toEqual([
      'windows-update-installer-missing',
    ]);
    expect(JSON.stringify(result)).not.toContain('codexwinmux Setup 0.4.2.exe');
  });

  it('accepts latest.yml when installer, size, sha, and blockmap align', async () => {
    const { evaluateWindowsUpdateMetadata } = await loadLib();

    const result = evaluateWindowsUpdateMetadata({
      latestMetadata: {
        version: '0.4.2',
        path: 'codexwinmux-Setup-0.4.2.exe',
        sha512: 'installer-sha',
        files: [
          {
            url: 'codexwinmux-Setup-0.4.2.exe',
            sha512: 'installer-sha',
            size: 123,
          },
        ],
      },
      appUpdateMetadata: {
        provider: 'github',
        owner: 'HardcoreMonk',
        repo: 'codexwinmux',
        updaterCacheDirName: 'codexwinmux-updater',
      },
      publishConfig: {
        provider: 'github',
        owner: 'HardcoreMonk',
        repo: 'codexwinmux',
      },
      releaseFiles: [
        { name: 'codexwinmux-Setup-0.4.2.exe', size: 123 },
        { name: 'codexwinmux-Setup-0.4.2.exe.blockmap', size: 12 },
      ],
    });

    expect(result).toMatchObject({
      ok: true,
      referencedInstallerName: 'codexwinmux-Setup-0.4.2.exe',
      releaseFileCount: 2,
      checks: [
        'windows-update-version-present',
        'windows-update-path-present',
        'windows-update-file-entry-present',
        'windows-update-path-file-entry-match',
        'windows-update-sha512-present',
        'windows-update-installer-file-present',
        'windows-update-installer-size-matches',
        'windows-update-blockmap-present',
        'windows-app-update-provider-github',
        'windows-app-update-publish-provider-github',
        'windows-app-update-owner-matches-publish',
        'windows-app-update-repo-matches-publish',
        'windows-app-update-cache-dir-present',
      ],
    });
  });

  it('reports a blocker when latest.yml size differs from the installer artifact', async () => {
    const { evaluateWindowsUpdateMetadata } = await loadLib();

    const result = evaluateWindowsUpdateMetadata({
      latestMetadata: {
        version: '0.4.2',
        path: 'codexwinmux-Setup-0.4.2.exe',
        sha512: 'installer-sha',
        files: [
          {
            url: 'codexwinmux-Setup-0.4.2.exe',
            sha512: 'installer-sha',
            size: 124,
          },
        ],
      },
      appUpdateMetadata: {
        provider: 'github',
        owner: 'HardcoreMonk',
        repo: 'codexwinmux',
        updaterCacheDirName: 'codexwinmux-updater',
      },
      publishConfig: {
        provider: 'github',
        owner: 'HardcoreMonk',
        repo: 'codexwinmux',
      },
      releaseFiles: [
        { name: 'codexwinmux-Setup-0.4.2.exe', size: 123 },
        { name: 'codexwinmux-Setup-0.4.2.exe.blockmap', size: 12 },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.blockers.map((blocker: { ruleId: string }) => blocker.ruleId)).toEqual([
      'windows-update-installer-size-mismatch',
    ]);
  });

  it('reports a blocker when packaged app-update.yml does not match publish config', async () => {
    const { evaluateWindowsUpdateMetadata } = await loadLib();

    const result = evaluateWindowsUpdateMetadata({
      latestMetadata: {
        version: '0.4.2',
        path: 'codexwinmux-Setup-0.4.2.exe',
        sha512: 'installer-sha',
        files: [
          {
            url: 'codexwinmux-Setup-0.4.2.exe',
            sha512: 'installer-sha',
            size: 123,
          },
        ],
      },
      appUpdateMetadata: {
        provider: 'github',
        owner: 'SomeoneElse',
        repo: 'codexwinmux',
        updaterCacheDirName: 'codexwinmux-updater',
      },
      publishConfig: {
        provider: 'github',
        owner: 'HardcoreMonk',
        repo: 'codexwinmux',
      },
      releaseFiles: [
        { name: 'codexwinmux-Setup-0.4.2.exe', size: 123 },
        { name: 'codexwinmux-Setup-0.4.2.exe.blockmap', size: 12 },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.appUpdate).toEqual({
      provider: 'github',
      owner: 'SomeoneElse',
      repo: 'codexwinmux',
      updaterCacheDirName: 'codexwinmux-updater',
    });
    expect(result.blockers.map((blocker: { ruleId: string }) => blocker.ruleId)).toEqual([
      'windows-app-update-owner-mismatch',
    ]);
  });

  it('reports a blocker when electron-builder publish provider is not GitHub', async () => {
    const { evaluateWindowsUpdateMetadata } = await loadLib();

    const result = evaluateWindowsUpdateMetadata({
      latestMetadata: {
        version: '0.4.2',
        path: 'codexwinmux-Setup-0.4.2.exe',
        sha512: 'installer-sha',
        files: [
          {
            url: 'codexwinmux-Setup-0.4.2.exe',
            sha512: 'installer-sha',
            size: 123,
          },
        ],
      },
      appUpdateMetadata: {
        provider: 'github',
        owner: 'HardcoreMonk',
        repo: 'codexwinmux',
        updaterCacheDirName: 'codexwinmux-updater',
      },
      publishConfig: {
        provider: 'generic',
        owner: 'HardcoreMonk',
        repo: 'codexwinmux',
      },
      releaseFiles: [
        { name: 'codexwinmux-Setup-0.4.2.exe', size: 123 },
        { name: 'codexwinmux-Setup-0.4.2.exe.blockmap', size: 12 },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.blockers.map((blocker: { ruleId: string }) => blocker.ruleId)).toEqual([
      'windows-app-update-publish-provider-mismatch',
    ]);
  });

  it('reports a blocker when packaged app-update.yml is missing', async () => {
    const { evaluateWindowsUpdateMetadata } = await loadLib();

    const result = evaluateWindowsUpdateMetadata({
      latestMetadata: {
        version: '0.4.2',
        path: 'codexwinmux-Setup-0.4.2.exe',
        sha512: 'installer-sha',
        files: [
          {
            url: 'codexwinmux-Setup-0.4.2.exe',
            sha512: 'installer-sha',
            size: 123,
          },
        ],
      },
      publishConfig: {
        provider: 'github',
        owner: 'HardcoreMonk',
        repo: 'codexwinmux',
      },
      releaseFiles: [
        { name: 'codexwinmux-Setup-0.4.2.exe', size: 123 },
        { name: 'codexwinmux-Setup-0.4.2.exe.blockmap', size: 12 },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.blockers.map((blocker: { ruleId: string }) => blocker.ruleId)).toEqual([
      'windows-app-update-yml-missing',
    ]);
  });
});
