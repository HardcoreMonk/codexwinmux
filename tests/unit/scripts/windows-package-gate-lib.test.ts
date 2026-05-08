import path from 'path';
import { pathToFileURL } from 'url';
import { describe, expect, it } from 'vitest';

const loadLib = async () =>
  import(pathToFileURL(path.join(process.cwd(), 'scripts/windows-package-gate-lib.mjs')).href);

describe('Windows package gate helpers', () => {
  it('keeps the package gate command list explicit and ordered', async () => {
    const { getWindowsPackageGateSteps } = await loadLib();

    expect(getWindowsPackageGateSteps()).toEqual([
      {
        id: 'windows-zip-artifact',
        script: 'smoke:windows:zip-artifact',
      },
      {
        id: 'windows-update-metadata',
        script: 'smoke:windows:update-metadata',
      },
      {
        id: 'windows-updater-local-feed',
        script: 'smoke:windows:updater-local-feed',
      },
      {
        id: 'windows-packaged-launch',
        script: 'smoke:windows:packaged-launch',
      },
      {
        id: 'windows-engine-lifecycle',
        script: 'smoke:windows:engine-lifecycle',
      },
      {
        id: 'windows-packaged-runtime-v2',
        script: 'smoke:windows:packaged-runtime-v2',
      },
      {
        id: 'windows-installer-runtime-v2',
        script: 'smoke:windows:installer-runtime-v2',
      },
    ]);
  });

  it('fails closed when a required package script is missing', async () => {
    const { validateWindowsPackageGatePackageScripts } = await loadLib();

    const result = validateWindowsPackageGatePackageScripts({
      scripts: {
        'smoke:windows:packaged-launch': 'node scripts/smoke-windows-packaged-launch.mjs',
      },
    });

    expect(result).toEqual({
      ok: false,
      missingScriptIds: [
        'smoke:windows:zip-artifact',
        'smoke:windows:update-metadata',
        'smoke:windows:updater-local-feed',
        'smoke:windows:engine-lifecycle',
        'smoke:windows:packaged-runtime-v2',
        'smoke:windows:installer-runtime-v2',
      ],
    });
  });

  it('runs steps sequentially and stops on the first package failure', async () => {
    const { runWindowsPackageGate } = await loadLib();
    const calls: string[] = [];

    const result = await runWindowsPackageGate({
      steps: [
        { id: 'packaged', script: 'smoke:packaged' },
        { id: 'installer', script: 'smoke:installer' },
        { id: 'after', script: 'smoke:after' },
      ],
      runStep: async (step: { id: string }) => {
        calls.push(step.id);
        return {
          ok: step.id !== 'installer',
          durationMs: 10,
          exitCode: step.id === 'installer' ? 1 : 0,
          signal: null,
        };
      },
    });

    expect(calls).toEqual(['packaged', 'installer']);
    expect(result).toMatchObject({
      ok: false,
      failedStepId: 'installer',
    });
    expect(result.results).toHaveLength(2);
  });

  it('builds package gate artifact payload without child raw output fields', async () => {
    const { buildWindowsPackageGateArtifactPayload } = await loadLib();

    const payload = buildWindowsPackageGateArtifactPayload({
      result: {
        ok: false,
        failedStepId: 'windows-installer-runtime-v2',
        results: [
          {
            id: 'windows-installer-runtime-v2',
            script: 'smoke:windows:installer-runtime-v2',
            ok: false,
            durationMs: 42,
            exitCode: 1,
            signal: null,
            stdout: 'installer stdout should not survive',
            stderr: 'installer stderr should not survive',
            outputTail: 'terminal output should not survive',
            error: 'installer failed without token details',
          },
        ],
      },
      durationMs: 99,
    });

    expect(payload).toEqual({
      ok: false,
      mutatesSystem: true,
      durationMs: 99,
      failedStepId: 'windows-installer-runtime-v2',
      results: [
        {
          id: 'windows-installer-runtime-v2',
          script: 'smoke:windows:installer-runtime-v2',
          ok: false,
          durationMs: 42,
          exitCode: 1,
          signal: null,
          error: 'installer failed without token details',
        },
      ],
    });
    expect(JSON.stringify(payload)).not.toContain('stdout should not survive');
    expect(JSON.stringify(payload)).not.toContain('terminal output');
  });
});
