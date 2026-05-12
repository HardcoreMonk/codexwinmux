import { describe, expect, it } from 'vitest';
import {
  buildUpdaterSmokeStatusEvent,
  readUpdaterSmokeConfig,
  sanitizeUpdaterDownloadedFileName,
} from '../../../electron/updater-smoke';

describe('Electron updater smoke helpers', () => {
  it('reads the local feed smoke configuration from env', () => {
    expect(readUpdaterSmokeConfig({
      CODEXMUX_ELECTRON_UPDATER_FEED_URL: 'http://127.0.0.1:8123/',
      CODEXMUX_ELECTRON_UPDATER_SMOKE: '1',
      CODEXMUX_ELECTRON_UPDATER_SMOKE_STATUS_PATH: 'C:\\tmp\\status.jsonl',
      CODEXMUX_ELECTRON_UPDATER_SMOKE_AUTO_DOWNLOAD: '1',
      CODEXMUX_ELECTRON_UPDATER_SMOKE_AUTO_INSTALL: '1',
      CODEXMUX_ELECTRON_UPDATER_SMOKE_INSTALL_DIR: 'C:\\tmp\\codexmux',
      CODEXMUX_ELECTRON_UPDATER_DISABLE_DIFFERENTIAL: '1',
    })).toEqual({
      enabled: true,
      feedUrl: 'http://127.0.0.1:8123/',
      statusPath: 'C:\\tmp\\status.jsonl',
      autoDownload: true,
      autoInstall: true,
      installDir: 'C:\\tmp\\codexmux',
      disableDifferentialDownload: true,
    });
  });

  it('prefers CODEXWINMUX updater smoke aliases over legacy CODEXMUX keys', () => {
    expect(readUpdaterSmokeConfig({
      CODEXWINMUX_ELECTRON_UPDATER_FEED_URL: 'http://127.0.0.1:8123/',
      CODEXWINMUX_ELECTRON_UPDATER_SMOKE: '1',
      CODEXWINMUX_ELECTRON_UPDATER_SMOKE_STATUS_PATH: 'C:\\tmp\\preferred-status.jsonl',
      CODEXWINMUX_ELECTRON_UPDATER_SMOKE_AUTO_DOWNLOAD: '1',
      CODEXWINMUX_ELECTRON_UPDATER_SMOKE_AUTO_INSTALL: '1',
      CODEXWINMUX_ELECTRON_UPDATER_SMOKE_INSTALL_DIR: 'C:\\tmp\\codexwinmux',
      CODEXWINMUX_ELECTRON_UPDATER_DISABLE_DIFFERENTIAL: '1',
      CODEXMUX_ELECTRON_UPDATER_FEED_URL: 'http://legacy.example/',
      CODEXMUX_ELECTRON_UPDATER_SMOKE_STATUS_PATH: 'C:\\tmp\\legacy-status.jsonl',
    })).toEqual({
      enabled: true,
      feedUrl: 'http://127.0.0.1:8123/',
      statusPath: 'C:\\tmp\\preferred-status.jsonl',
      autoDownload: true,
      autoInstall: true,
      installDir: 'C:\\tmp\\codexwinmux',
      disableDifferentialDownload: true,
    });
  });

  it('ignores smoke config when the smoke flag is not enabled', () => {
    expect(readUpdaterSmokeConfig({
      CODEXMUX_ELECTRON_UPDATER_FEED_URL: 'http://127.0.0.1:8123/',
    })).toEqual({
      enabled: false,
      feedUrl: null,
      statusPath: null,
      autoDownload: false,
      autoInstall: false,
      installDir: null,
      disableDifferentialDownload: false,
    });
  });

  it('keeps updater status events path-light', () => {
    expect(sanitizeUpdaterDownloadedFileName('C:\\Users\\me\\AppData\\Local\\codexwinmux-updater\\pending\\codexwinmux.exe'))
      .toBe('codexwinmux.exe');

    expect(buildUpdaterSmokeStatusEvent('update-downloaded', {
      version: '0.4.3',
      downloadedFile: 'C:\\Users\\me\\AppData\\Local\\codexwinmux-updater\\pending\\codexwinmux.exe',
    })).toMatchObject({
      event: 'update-downloaded',
      version: '0.4.3',
      downloadedFileName: 'codexwinmux.exe',
    });
  });
});
