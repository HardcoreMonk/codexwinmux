import { describe, expect, it } from 'vitest';
import path from 'path';
import { pathToFileURL } from 'url';

const loadLib = async () =>
  import(pathToFileURL(path.join(process.cwd(), 'scripts/windows-core-backend-split-lifecycle-lib.mjs')).href);

interface ILifecycleStep {
  id: string;
  kind: string;
  durationMs?: number;
  timeoutMs?: number;
  retryIntervalMs?: number;
  command: {
    args: string[];
  };
}

describe('windows core/backend split lifecycle smoke plan', () => {
  it('builds split-mode service commands for every lifecycle step', async () => {
    const { buildSplitLifecyclePlan, validateSplitLifecyclePlan } = await loadLib();
    const plan = buildSplitLifecyclePlan();

    expect(validateSplitLifecyclePlan(plan)).toEqual({ ok: true, failures: [] });
    expect((plan as ILifecycleStep[]).map((step) => step.id)).toEqual([
      'write-config',
      'install-core',
      'install-backend',
      'start-core',
      'start-backend',
      'phase6-health-initial',
      'restart-backend-stop',
      'restart-backend-start',
      'phase6-health-after-backend-restart',
      'restart-core-stop',
      'restart-core-start',
      'phase6-health-after-core-restart',
      'cleanup-stop-backend',
      'cleanup-stop-core',
    ]);
    for (const step of plan as ILifecycleStep[]) {
      expect(step.command.args).toContain('-Mode');
      expect(step.command.args).toContain('split');
    }
  });

  it('keeps core/backend restart order explicit', async () => {
    const { buildSplitLifecyclePlan } = await loadLib();
    const plan = buildSplitLifecyclePlan();
    const index = (id: string): number => (plan as ILifecycleStep[]).findIndex((step) => step.id === id);

    expect(index('start-core')).toBeLessThan(index('start-backend'));
    expect(index('restart-backend-stop')).toBeLessThan(index('restart-backend-start'));
    expect(index('restart-core-stop')).toBeLessThan(index('restart-core-start'));
    expect(index('cleanup-stop-backend')).toBeLessThan(index('cleanup-stop-core'));
  });

  it('waits for backend health because WinSW start can return before HTTP is ready', async () => {
    const { buildSplitLifecyclePlan } = await loadLib();
    const healthSteps = (buildSplitLifecyclePlan() as ILifecycleStep[])
      .filter((step) => step.kind === 'health-check');

    expect(healthSteps.map((step) => step.id)).toEqual([
      'phase6-health-initial',
      'phase6-health-after-backend-restart',
      'phase6-health-after-core-restart',
    ]);
    for (const step of healthSteps) {
      expect(step.timeoutMs).toBeGreaterThanOrEqual(60_000);
      expect(step.retryIntervalMs).toBeGreaterThan(0);
    }
  });

  it('can add an optional stability hold before cleanup', async () => {
    const { buildSplitLifecyclePlan } = await loadLib();
    const plan = buildSplitLifecyclePlan({ stabilityMs: 120_000 }) as ILifecycleStep[];
    const index = (id: string): number => plan.findIndex((step) => step.id === id);
    const hold = plan.find((step) => step.id === 'split-stability-hold');

    expect(hold).toMatchObject({
      kind: 'stability-hold',
      durationMs: 120_000,
    });
    expect(index('phase6-health-after-core-restart')).toBeLessThan(index('split-stability-hold'));
    expect(index('split-stability-hold')).toBeLessThan(index('cleanup-stop-backend'));
  });

  it('normalizes optional stability duration', async () => {
    const { normalizeSplitLifecycleStabilityMs } = await loadLib();

    expect(normalizeSplitLifecycleStabilityMs('90000')).toBe(90_000);
    expect(normalizeSplitLifecycleStabilityMs('0')).toBe(0);
    expect(normalizeSplitLifecycleStabilityMs('bad', 5_000)).toBe(5_000);
  });


  it('fails validation when cleanup would stop core before backend', async () => {
    const { buildSplitLifecyclePlan, validateSplitLifecyclePlan } = await loadLib();
    const plan = buildSplitLifecyclePlan();
    const typedPlan = plan as ILifecycleStep[];
    const backendStop = typedPlan.find((step) => step.id === 'cleanup-stop-backend');
    const coreStop = typedPlan.find((step) => step.id === 'cleanup-stop-core');
    const broken = typedPlan
      .filter((step) => step.id !== 'cleanup-stop-backend' && step.id !== 'cleanup-stop-core')
      .concat([coreStop!, backendStop!]);

    expect(validateSplitLifecyclePlan(broken)).toMatchObject({
      ok: false,
      failures: expect.arrayContaining(['cleanup-must-stop-backend-before-core']),
    });
  });

  it('creates direct helper commands for role-scoped service operations', async () => {
    const { buildWindowsServiceCommand } = await loadLib();
    expect(buildWindowsServiceCommand({ action: 'start', role: 'core' })).toEqual({
      program: 'powershell',
      args: [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        'scripts/windows-service.ps1',
        'start',
        '-Mode',
        'split',
        '-Role',
        'core',
      ],
    });
  });
});
