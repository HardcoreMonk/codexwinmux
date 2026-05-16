import { spawnSync } from 'node:child_process';
import {
  buildSplitLifecyclePlan,
  normalizeSplitLifecycleStabilityMs,
  validateSplitLifecyclePlan,
} from './windows-core-backend-split-lifecycle-lib.mjs';

const shouldMutate = process.env.CODEXWINMUX_WINDOWS_SPLIT_LIFECYCLE_MUTATE === '1';

const runCommand = (step) => {
  if (!step.command) return;
  if (step.kind === 'stability-hold') {
    const deadline = Date.now() + step.durationMs;
    let samples = 0;
    do {
      const result = spawnSync(step.command.program, step.command.args, {
        cwd: process.cwd(),
        stdio: 'inherit',
        shell: false,
      });
      if ((result.status ?? 1) !== 0) {
        throw new Error(`split lifecycle stability health failed: ${step.id}`);
      }
      samples++;
      if (Date.now() >= deadline) break;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, step.retryIntervalMs ?? 5_000);
    } while (Date.now() < deadline);
    return { id: step.id, samples, durationMs: step.durationMs };
  }
  const deadline = Date.now() + (step.kind === 'health-check' ? step.timeoutMs ?? 60_000 : 0);
  let lastStatus = 1;
  do {
    const result = spawnSync(step.command.program, step.command.args, {
      cwd: process.cwd(),
      stdio: 'inherit',
      shell: false,
    });
    lastStatus = result.status ?? 1;
    if (lastStatus === 0) return;
    if (step.kind !== 'health-check' || Date.now() >= deadline) break;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, step.retryIntervalMs ?? 1_000);
  } while (Date.now() < deadline);
  if (lastStatus !== 0) {
    throw new Error(`split lifecycle step failed: ${step.id}`);
  }
};

const main = () => {
  const stabilityMs = normalizeSplitLifecycleStabilityMs(
    process.env.CODEXWINMUX_WINDOWS_SPLIT_LIFECYCLE_STABILITY_MS,
  );
  const plan = buildSplitLifecyclePlan({ stabilityMs });
  const validation = validateSplitLifecyclePlan(plan);
  if (!validation.ok) {
    throw new Error(`invalid split lifecycle plan: ${validation.failures.join(', ')}`);
  }

  if (process.platform !== 'win32' || !shouldMutate) {
    console.log(JSON.stringify({
      ok: true,
      dryRun: true,
      skippedMutation: process.platform !== 'win32'
        ? 'windows-only'
        : 'set CODEXWINMUX_WINDOWS_SPLIT_LIFECYCLE_MUTATE=1 to run service stop/start',
      checks: [
        'split-lifecycle-plan-valid',
        'core-starts-before-backend',
        'backend-restart-preserves-core',
        'core-restart-degrade-recover-sequence',
        'cleanup-stops-backend-before-core',
        ...(stabilityMs > 0 ? ['split-stability-hold-planned'] : []),
      ],
      stabilityMs,
      plan,
    }, null, 2));
    return;
  }

  const evidence = [];
  for (const step of plan) {
    const result = runCommand(step);
    if (result) evidence.push(result);
  }
  console.log(JSON.stringify({
    ok: true,
    dryRun: false,
    stabilityMs,
    checks: [
      'split-lifecycle-mutating-run-complete',
      'core-backend-independent-service-commands',
      ...(stabilityMs > 0 ? ['split-stability-hold-complete'] : []),
    ],
    evidence,
  }, null, 2));
};

try {
  main();
} catch (err) {
  console.error(err instanceof Error ? err.stack || err.message : err);
  process.exit(1);
}
