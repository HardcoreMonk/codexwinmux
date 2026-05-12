import { describe, expect, it } from 'vitest';
import { resolveTrayIconPath } from '../../../electron/tray-icon';

describe('Electron tray icon helpers', () => {
  it('uses the packaged Windows resources icon instead of the app executable', () => {
    expect(resolveTrayIconPath({
      platform: 'win32',
      isPackaged: true,
      resourcesPath: 'C:\\apps\\codexwinmux\\resources',
      appPath: 'C:\\apps\\codexwinmux\\resources\\app.asar',
    })).toBe('C:\\apps\\codexwinmux\\resources\\icon.ico');
  });

  it('uses the dev build resource icon on Windows', () => {
    expect(resolveTrayIconPath({
      platform: 'win32',
      isPackaged: false,
      appPath: 'D:\\repo\\codexwinmux',
    })).toBe('D:\\repo\\codexwinmux\\build-resources\\icon.ico');
  });

  it('keeps non-Windows platforms on the existing empty native image path', () => {
    expect(resolveTrayIconPath({ platform: 'darwin' })).toBeNull();
  });
});
