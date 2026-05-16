import { describe, expect, it } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { pathToFileURL } from 'url';

const loadLib = async () =>
  import(pathToFileURL(path.join(process.cwd(), 'scripts/status-timeline-stale-ui-smoke-lib.mjs')).href);

describe('status/timeline stale UI smoke helpers', () => {
  it('normalizes stale UI smoke timeout values', async () => {
    const { normalizeStatusTimelineStaleUiSmokeTimeoutMs } = await loadLib();

    expect(normalizeStatusTimelineStaleUiSmokeTimeoutMs(undefined)).toBe(45_000);
    expect(normalizeStatusTimelineStaleUiSmokeTimeoutMs('5000')).toBe(5_000);
    expect(normalizeStatusTimelineStaleUiSmokeTimeoutMs('100')).toBe(1_000);
    expect(normalizeStatusTimelineStaleUiSmokeTimeoutMs('999999')).toBe(180_000);
    expect(normalizeStatusTimelineStaleUiSmokeTimeoutMs('nope')).toBe(45_000);
  });

  it('builds browser scripts for WebSocket probing and native app state events', async () => {
    const {
      STATUS_TIMELINE_STALE_UI_PROBE_GLOBAL,
      buildDispatchNativeAppStateScript,
      buildInstallStatusTimelineStaleUiProbeScript,
      buildReadStatusTimelineStaleUiProbeScript,
    } = await loadLib();

    const installScript = buildInstallStatusTimelineStaleUiProbeScript();
    expect(installScript).toContain(STATUS_TIMELINE_STALE_UI_PROBE_GLOBAL);
    expect(installScript).toContain('class CodexwinmuxProbeWebSocket');
    expect(installScript).toContain('/api/status');
    expect(installScript).toContain('/api/timeline');

    expect(buildDispatchNativeAppStateScript(false)).toContain('active: false');
    expect(buildDispatchNativeAppStateScript(true)).toContain('codexmux:native-app-state');
    expect(buildReadStatusTimelineStaleUiProbeScript()).toContain(`${STATUS_TIMELINE_STALE_UI_PROBE_GLOBAL}.events`);
  });

  it('keeps the stale UI smoke on an isolated Core host instead of an installed split service', async () => {
    const source = await fs.readFile(
      path.join(process.cwd(), 'scripts/smoke-runtime-v2-status-timeline-stale-ui.mjs'),
      'utf-8',
    );

    expect(source).toContain('startCoreServer');
    expect(source).toContain("entrypoint: 'src/workers/core-engine-host.ts'");
    expect(source).toContain('CODEXWINMUX_CORE_ENGINE_PORT');
  });
});
