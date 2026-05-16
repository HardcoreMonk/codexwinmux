import path from 'path';
import { pathToFileURL } from 'url';
import { describe, expect, it } from 'vitest';

const loadLib = async () =>
  import(pathToFileURL(path.join(process.cwd(), 'scripts/windows-release-gate-lib.mjs')).href);

describe('Windows release gate helpers', () => {
  it('keeps the Windows release gate command list explicit and ordered', async () => {
    const { getWindowsReleaseGateSteps } = await loadLib();

    expect(getWindowsReleaseGateSteps().map((step: { id: string }) => step.id)).toEqual([
      'windows-platform-audit',
      'windows-runtime-v2-terminal',
      'windows-preflight',
      'windows-service-host',
      'windows-service-account',
      'windows-core-engine-ipc',
      'windows-core-backend-external-transport',
      'windows-core-backend-split-lifecycle',
      'windows-host-diagnostics',
      'windows-electron-env',
      'windows-electron-packaging',
      'windows-codex-session',
    ]);
  });

  it('fails closed when a required package script is missing', async () => {
    const { validateWindowsReleaseGatePackageScripts } = await loadLib();
    const result = validateWindowsReleaseGatePackageScripts({
      scripts: {
        'audit:windows-platform': 'node scripts/windows-platform-blockers.mjs',
        'smoke:windows:preflight': 'tsx scripts/smoke-windows-preflight.ts',
      },
    });

    expect(result.ok).toBe(false);
    expect(result.missingScriptIds).toContain('smoke:runtime-v2:terminal-windows');
    expect(result.missingScriptIds).toContain('smoke:windows:service-account');
    expect(result.missingScriptIds).toContain('smoke:windows:core-engine-ipc');
    expect(result.missingScriptIds).toContain('smoke:windows:core-backend-external-transport');
    expect(result.missingScriptIds).toContain('smoke:windows:core-backend-split-lifecycle');
    expect(result.missingScriptIds).toContain('smoke:windows:electron-packaging');
  });

  it('builds child package script env with known upstream deprecation warnings suppressed', async () => {
    const { buildPackageScriptEnv } = await loadLib();

    const env = buildPackageScriptEnv({
      env: {
        NODE_OPTIONS: '--trace-warnings --disable-warning=DEP0190',
      },
    });

    expect(env.NODE_OPTIONS).toContain('--trace-warnings');
    expect(env.NODE_OPTIONS).toContain('--disable-warning=DEP0176');
    expect(env.NODE_OPTIONS.match(/--disable-warning=DEP0190/g)).toHaveLength(1);
  });

  it('runs steps sequentially and stops on the first failure', async () => {
    const { runWindowsReleaseGate } = await loadLib();
    const calls: string[] = [];
    const result = await runWindowsReleaseGate({
      steps: [
        { id: 'first', script: 'smoke:first' },
        { id: 'second', script: 'smoke:second' },
        { id: 'third', script: 'smoke:third' },
      ],
      runStep: async (step: { id: string }) => {
        calls.push(step.id);
        return {
          ok: step.id !== 'second',
          durationMs: 10,
          exitCode: step.id === 'second' ? 1 : 0,
        };
      },
    });

    expect(calls).toEqual(['first', 'second']);
    expect(result).toMatchObject({
      ok: false,
      failedStepId: 'second',
    });
    expect(result.results).toHaveLength(2);
  });

  it('builds release gate artifact payload without child raw output fields', async () => {
    const { buildWindowsReleaseGateArtifactPayload } = await loadLib();
    const payload = buildWindowsReleaseGateArtifactPayload({
      result: {
        ok: false,
        failedStepId: 'windows-runtime-v2-terminal',
        results: [
          {
            id: 'windows-runtime-v2-terminal',
            script: 'smoke:runtime-v2:terminal-windows',
            ok: false,
            durationMs: 42,
            exitCode: 1,
            signal: null,
            outputTail: 'terminal output should not survive',
            stdout: 'raw stdout should not survive',
            error: 'failed without token details',
          },
        ],
      },
      durationMs: 99,
    });

    expect(payload).toEqual({
      ok: false,
      mutatesSystem: false,
      durationMs: 99,
      failedStepId: 'windows-runtime-v2-terminal',
      results: [
        {
          id: 'windows-runtime-v2-terminal',
          script: 'smoke:runtime-v2:terminal-windows',
          ok: false,
          durationMs: 42,
          exitCode: 1,
          signal: null,
          error: 'failed without token details',
        },
      ],
    });
  });
});
