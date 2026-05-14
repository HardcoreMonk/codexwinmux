import { describe, expect, it } from 'vitest';
import path from 'path';
import { pathToFileURL } from 'url';

const loadLib = async () =>
  import(pathToFileURL(path.join(process.cwd(), 'scripts/browser-sync-smoke-lib.mjs')).href);

describe('browser sync smoke helpers', () => {
  it('normalizes browser sync smoke timeout values', async () => {
    const { normalizeBrowserSyncSmokeTimeoutMs } = await loadLib();

    expect(normalizeBrowserSyncSmokeTimeoutMs(undefined)).toBe(30_000);
    expect(normalizeBrowserSyncSmokeTimeoutMs('5000')).toBe(5_000);
    expect(normalizeBrowserSyncSmokeTimeoutMs('100')).toBe(1_000);
    expect(normalizeBrowserSyncSmokeTimeoutMs('999999')).toBe(120_000);
    expect(normalizeBrowserSyncSmokeTimeoutMs('nope')).toBe(30_000);
  });

  it('builds a page-context sync probe for one workspace event', async () => {
    const {
      BROWSER_SYNC_PROBE_GLOBAL,
      buildInstallBrowserSyncProbeScript,
      buildReadBrowserSyncProbeEventScript,
    } = await loadLib();

    const script = buildInstallBrowserSyncProbeScript({
      expectedType: 'layout',
      workspaceId: 'ws-a',
      timeoutMs: 10_000,
    });

    expect(script).toContain('/api/sync');
    expect(script).toContain(BROWSER_SYNC_PROBE_GLOBAL);
    expect(script).toContain('"layout"');
    expect(script).toContain('"ws-a"');
    expect(script).toContain('new WebSocket');
    expect(buildReadBrowserSyncProbeEventScript()).toContain(`${BROWSER_SYNC_PROBE_GLOBAL}.event`);
  });
});
