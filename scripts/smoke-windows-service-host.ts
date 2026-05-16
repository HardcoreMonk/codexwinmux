import { resolveWindowsServiceHostPlan } from '@/lib/windows-service-host';
import { readFileSync } from 'fs';
import path from 'path';

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

  const servicePlan = resolveWindowsServiceHostPlan({
    platform: process.platform,
    env: {
      ...process.env,
      CODEXWINMUX_WINDOWS_HOST_OWNER: 'service',
      CODEXWINMUX_WINDOWS_SERVICE_EXE: process.env.CODEXWINMUX_WINDOWS_SERVICE_EXE
        || `${process.cwd()}\\release\\win-unpacked\\codexwinmux.exe`,
    },
    appDir: process.cwd(),
  });

  if (servicePlan.owner !== 'service') {
    throw new Error(`Windows service owner plan did not select service owner: ${JSON.stringify(servicePlan)}`);
  }
  if (servicePlan.hostModel !== 'windows-service-owner-capable') {
    throw new Error(`unexpected Windows service owner model: ${servicePlan.hostModel}`);
  }
  if (!servicePlan.requiresElevation) {
    throw new Error('Windows service owner plan must require elevation.');
  }
  if (servicePlan.mutatesSystem) {
    throw new Error('Windows service owner plan must remain non-mutating in smoke.');
  }
  if (!servicePlan.service.executableArgs.some((arg) => arg.endsWith('resources\\app.asar\\dist\\server.js'))) {
    throw new Error(`Windows service owner plan must launch packaged backend server host: ${JSON.stringify(servicePlan.service)}`);
  }
  if (servicePlan.service.commands.install.mutatesSystem || servicePlan.service.commands.start.mutatesSystem) {
    throw new Error(`Windows service commands must be planned, not executed: ${JSON.stringify(servicePlan.service.commands)}`);
  }
  if (servicePlan.service.wrapper.kind !== 'winsw') {
    throw new Error(`Windows service owner plan must use WinSW wrapper: ${JSON.stringify(servicePlan.service.wrapper)}`);
  }
  if (servicePlan.service.commands.install.args.join(' ') !== 'install') {
    throw new Error(`Windows service install command must use WinSW install: ${JSON.stringify(servicePlan.service.commands.install)}`);
  }
  if (servicePlan.operationDecision.serviceAccount.target !== 'dedicated-local-service-account') {
    throw new Error(`Windows service account target decision drifted: ${JSON.stringify(servicePlan.operationDecision.serviceAccount)}`);
  }
  if (servicePlan.operationDecision.serviceAccount.serviceAccountName !== 'codexwinmux-svc') {
    throw new Error(`Windows service account name decision drifted: ${JSON.stringify(servicePlan.operationDecision.serviceAccount)}`);
  }
  if (
    servicePlan.operationDecision.installer.nsisServiceOption !== 'runbook-default-off'
    || servicePlan.operationDecision.installer.defaultEnabled !== false
  ) {
    throw new Error(`NSIS service install option must remain runbook/default-off: ${JSON.stringify(servicePlan.operationDecision.installer)}`);
  }
  checks.push('windows-service-owner-plan');
  checks.push('windows-service-backend-server-host');
  checks.push('windows-service-winsw-wrapper');
  checks.push('windows-service-non-mutating-commands');
  checks.push('windows-service-dedicated-account-runbook');
  checks.push('windows-service-nsis-runbook-option-default-off');

  const splitPlan = resolveWindowsServiceHostPlan({
    platform: process.platform,
    mode: 'split',
    env: {
      ...process.env,
      CODEXWINMUX_WINDOWS_HOST_OWNER: 'service',
      CODEXWINMUX_WINDOWS_SERVICE_EXE: servicePlan.service.executablePath,
    },
    appDir: process.cwd(),
  });
  if (!splitPlan.splitServices) {
    throw new Error(`Windows split service plan was not created: ${JSON.stringify(splitPlan)}`);
  }
  if (splitPlan.splitServices.defaultEnabled !== true) {
    throw new Error(`Windows split service mode must be default-on: ${JSON.stringify(splitPlan.splitServices)}`);
  }
  if (splitPlan.splitServices.backend.name !== 'codexwinmux-backend') {
    throw new Error(`unexpected backend service name: ${JSON.stringify(splitPlan.splitServices.backend)}`);
  }
  if (splitPlan.splitServices.core.name !== 'codexwinmux-core') {
    throw new Error(`unexpected core service name: ${JSON.stringify(splitPlan.splitServices.core)}`);
  }
  if (!splitPlan.splitServices.backend.executableArgs.some((arg) => arg.endsWith('resources\\app.asar\\dist\\server.js'))) {
    throw new Error(`backend split service must launch packaged backend server host: ${JSON.stringify(splitPlan.splitServices.backend)}`);
  }
  if (!splitPlan.splitServices.core.executableArgs.some((arg) => arg.endsWith('resources\\app.asar.unpacked\\dist\\workers\\core-engine-host.js'))) {
    throw new Error(`core split service must launch packaged core worker host: ${JSON.stringify(splitPlan.splitServices.core)}`);
  }
  checks.push('windows-service-split-plan');
  checks.push('windows-service-split-default-on');
  checks.push('windows-service-split-core-worker-host');

  const helperPath = path.join(process.cwd(), servicePlan.operationDecision.runbook.helperScript);
  const helper = readFileSync(helperPath, 'utf8');
  for (const action of servicePlan.operationDecision.runbook.actions) {
    if (!helper.includes(`'${action}'`)) {
      throw new Error(`Windows service helper is missing action ${action}: ${helperPath}`);
    }
  }
  if (!helper.includes('dist\\server.js')) {
    throw new Error(`Windows service helper must write the packaged backend server host: ${helperPath}`);
  }
  if (!helper.includes('core-engine-host.js') || !helper.includes('ELECTRON_RUN_AS_NODE') || !helper.includes('[string]$Mode')) {
    throw new Error(`Windows service helper must expose split mode and packaged core worker host: ${helperPath}`);
  }
  if (
    !helper.includes('CODEXWINMUX_CORE_ENGINE_TRANSPORT')
    || !helper.includes('CODEXWINMUX_CORE_ENGINE_HOST')
    || !helper.includes('CODEXWINMUX_CORE_ENGINE_PORT')
  ) {
    throw new Error(`Windows service helper must configure split Backend/Core external transport: ${helperPath}`);
  }
  if (
    !helper.includes('__CMUX_APP_DIR_UNPACKED')
    || !helper.includes('NODE_PATH')
    || !helper.includes('NODE_ENV')
    || !helper.includes('production')
  ) {
    throw new Error(`Windows service helper must configure packaged runtime worker paths: ${helperPath}`);
  }
  checks.push('windows-service-runbook-helper');
  checks.push('windows-service-split-external-transport-env');
  checks.push('windows-service-packaged-worker-env');

  if (!plan.paths.dataDir.endsWith('.codexwinmux') || !plan.paths.codexDir.endsWith('.codex')) {
    throw new Error(`unexpected Windows data paths: ${JSON.stringify(plan.paths)}`);
  }
  checks.push('windows-data-paths');

  console.log(JSON.stringify({
    ok: true,
    checks,
    owner: plan.owner,
    hostModel: plan.hostModel,
    serviceOwner: {
      owner: servicePlan.owner,
      hostModel: servicePlan.hostModel,
      requiresElevation: servicePlan.requiresElevation,
      service: servicePlan.service,
      splitServices: splitPlan.splitServices,
    },
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
