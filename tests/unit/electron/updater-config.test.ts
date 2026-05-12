import { describe, expect, it } from 'vitest';
import { applyAutoUpdaterRuntimeDefaults } from '../../../electron/updater-config';

describe('Electron updater runtime defaults', () => {
  it('disables web installer downloads for the offline NSIS installer contract', () => {
    const updater = {
      autoDownload: true,
      autoInstallOnAppQuit: false,
      disableWebInstaller: false,
    };

    applyAutoUpdaterRuntimeDefaults(updater);

    expect(updater).toEqual({
      autoDownload: false,
      autoInstallOnAppQuit: true,
      disableWebInstaller: true,
    });
  });
});
