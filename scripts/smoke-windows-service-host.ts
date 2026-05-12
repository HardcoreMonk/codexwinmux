import { resolveWindowsServiceHostPlan } from '@/lib/windows-service-host';

const main = async (): Promise<void> => {
  const plan = resolveWindowsServiceHostPlan({
    platform: process.platform,
    env: process.env,
    appDir: process.cwd(),
  });

  if (process.platform !== 'win32') {
    console.log(JSON.stringify({
      ok: true,
      skipped: true,
      reason: plan.reason,
    }, null, 2));
    return;
  }

  const checks: string[] = [];

  if (plan.skipped) {
    throw new Error(`Windows service host plan unexpectedly skipped: ${JSON.stringify(plan)}`);
  }
  if (plan.reason) {
    throw new Error(`Windows service host plan is not ready: ${plan.reason}`);
  }
  checks.push('platform-win32');

  if (plan.hostModel !== 'tray-first-service-capable') {
    throw new Error(`unexpected Windows host model: ${plan.hostModel}`);
  }
  checks.push('tray-first-service-capable');

  if (plan.mutatesSystem) {
    throw new Error('Windows service host baseline smoke must not mutate the system.');
  }
  checks.push('dry-run-no-system-mutation');

  if (plan.process.env.CODEXWINMUX_RUNTIME_TERMINAL_ADAPTER !== 'windows') {
    throw new Error(`Windows terminal adapter is not selected: ${JSON.stringify(plan.process.env)}`);
  }
  checks.push('windows-terminal-adapter');

  if (plan.process.env.CODEXWINMUX_PROCESS_INSPECTOR_ADAPTER !== 'windows') {
    throw new Error(`Windows process inspector is not selected: ${JSON.stringify(plan.process.env)}`);
  }
  checks.push('windows-process-inspector-adapter');

  if (!plan.paths.dataDir.endsWith('.codexwinmux') || !plan.paths.codexDir.endsWith('.codex')) {
    throw new Error(`unexpected Windows data paths: ${JSON.stringify(plan.paths)}`);
  }
  checks.push('windows-data-paths');

  console.log(JSON.stringify({
    ok: true,
    checks,
    owner: plan.owner,
    hostModel: plan.hostModel,
    requiresElevation: plan.requiresElevation,
    service: plan.service,
    process: plan.process,
    paths: plan.paths,
    restartPolicy: plan.restartPolicy,
  }, null, 2));
};

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : err);
  process.exit(1);
});
