import { describe, expect, it } from 'vitest';
import path from 'path';
import { pathToFileURL } from 'url';

const loadLib = async () =>
  import(pathToFileURL(path.join(process.cwd(), 'scripts/android-gradle-lib.mjs')).href);

describe('android gradle runner helpers', () => {
  it('selects gradlew.bat and fills Windows Android environment defaults', async () => {
    const { buildAndroidGradleInvocation } = await loadLib();

    const invocation = buildAndroidGradleInvocation({
      rootDir: 'D:\\repo',
      platform: 'win32',
      env: {
        PATH: 'C:\\Windows\\System32',
      },
      args: ['assembleDebug'],
    });

    expect(invocation.command).toBe('gradlew.bat');
    expect(invocation.args).toEqual(['assembleDebug']);
    expect(invocation.cwd).toBe(path.join('D:\\repo', 'android'));
    expect(invocation.env.PATH).toContain('C:\\Windows\\System32');
  });

  it('uses the POSIX wrapper outside Windows', async () => {
    const { buildAndroidGradleInvocation } = await loadLib();

    const invocation = buildAndroidGradleInvocation({
      rootDir: '/repo',
      platform: 'linux',
      env: { PATH: '/usr/bin' },
      args: ['testDebugUnitTest'],
    });

    expect(invocation.command).toBe('./gradlew');
    expect(invocation.cwd).toBe(path.join('/repo', 'android'));
  });
});
