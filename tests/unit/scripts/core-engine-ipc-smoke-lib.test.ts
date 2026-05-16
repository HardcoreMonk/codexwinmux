import path from 'path';
import { pathToFileURL } from 'url';
import { describe, expect, it } from 'vitest';

const loadLib = async () =>
  import(pathToFileURL(path.join(process.cwd(), 'scripts/core-engine-ipc-smoke-lib.mjs')).href);

describe('core engine IPC smoke helpers', () => {
  it('builds a default launch plan for the built core host worker', async () => {
    const { buildCoreEngineIpcLaunchPlan } = await loadLib();

    expect(buildCoreEngineIpcLaunchPlan({
      cwd: 'D:\\repo',
      env: {},
    })).toMatchObject({
      scriptPath: path.join('D:\\repo', 'dist', 'workers', 'core-engine-host.js'),
      env: {
        CODEXWINMUX_RUNTIME_V2: '1',
        CODEXWINMUX_RUNTIME_TERMINAL_ADAPTER: 'windows',
        CODEXWINMUX_PROCESS_INSPECTOR_ADAPTER: 'windows',
      },
    });
  });

  it('creates the backend-to-core health command envelope', async () => {
    const { createCoreHealthCommand } = await loadLib();

    expect(createCoreHealthCommand('cmd-a')).toEqual({
      kind: 'command',
      id: 'cmd-a',
      source: 'backend',
      target: 'core',
      type: 'core.health',
      payload: {},
    });
  });

  it('sanitizes IPC smoke evidence without raw worker payloads', async () => {
    const { buildCoreEngineIpcSmokePayload } = await loadLib();

    const payload = buildCoreEngineIpcSmokePayload({
      ok: true,
      eventReceived: true,
      reply: {
        ok: true,
        payload: {
          ok: true,
          runtime: {
            ok: true,
            storage: { ok: true, secret: 'do-not-copy' },
            terminal: { ok: true },
            timeline: { ok: true },
            status: { ok: true },
          },
        },
      },
    });

    expect(payload).toEqual({
      ok: true,
      mutatesSystem: false,
      checks: ['core-health-event', 'core-health-reply'],
      health: {
        ok: true,
        runtimeOk: true,
        workers: {
          storage: true,
          terminal: true,
          timeline: true,
          status: true,
        },
      },
      exitCode: null,
      signal: null,
    });
    expect(JSON.stringify(payload)).not.toContain('do-not-copy');
  });
});
