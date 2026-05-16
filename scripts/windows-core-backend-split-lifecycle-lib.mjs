const splitModeArgs = ['-Mode', 'split'];

export const splitLifecycleStepIds = [
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
];

export const normalizeSplitLifecycleStabilityMs = (raw, fallback = 0) => {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
};

export const buildWindowsServiceCommand = ({
  action,
  role = 'all',
  script = 'scripts/windows-service.ps1',
  shell = 'powershell',
}) => ({
  program: shell,
  args: [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    script,
    action,
    ...splitModeArgs,
    '-Role',
    role,
  ],
});

const serviceStep = (id, action, role, objective) => ({
  id,
  kind: 'service-command',
  action,
  role,
  objective,
  command: buildWindowsServiceCommand({ action, role }),
});

const healthStep = (id, objective) => ({
  id,
  kind: 'health-check',
  objective,
  timeoutMs: 60_000,
  retryIntervalMs: 1_000,
  url: 'http://127.0.0.1:8121/api/v2/runtime/health',
  expected: {
    terminalV2Mode: 'new-tabs',
    storageV2Mode: 'default',
    timelineV2Mode: 'default',
    statusV2Mode: 'default',
  },
  command: buildWindowsServiceCommand({ action: 'health', role: 'backend' }),
});

const stabilityStep = (durationMs) => ({
  id: 'split-stability-hold',
  kind: 'stability-hold',
  objective: 'backend remains healthy while attached to the split core service',
  durationMs,
  retryIntervalMs: 5_000,
  command: buildWindowsServiceCommand({ action: 'health', role: 'backend' }),
});

export const buildSplitLifecyclePlan = ({ stabilityMs = 0 } = {}) => {
  const plan = [
    serviceStep('write-config', 'write-config', 'all', 'core/backend WinSW configs are written without installing services'),
    serviceStep('install-core', 'install', 'core', 'core service is installable independently'),
    serviceStep('install-backend', 'install', 'backend', 'backend service is installable independently'),
    serviceStep('start-core', 'start', 'core', 'core starts before backend attaches'),
    serviceStep('start-backend', 'start', 'backend', 'backend attaches to an already running core'),
    healthStep('phase6-health-initial', 'runtime Phase 6 health is available after backend attach'),
    serviceStep('restart-backend-stop', 'stop', 'backend', 'backend can stop while core remains running'),
    serviceStep('restart-backend-start', 'start', 'backend', 'backend can reattach without restarting core'),
    healthStep('phase6-health-after-backend-restart', 'runtime health recovers after backend restart'),
    serviceStep('restart-core-stop', 'stop', 'core', 'backend health degrades while core is unavailable'),
    serviceStep('restart-core-start', 'start', 'core', 'backend health recovers when core returns'),
    healthStep('phase6-health-after-core-restart', 'runtime health recovers after core restart'),
  ];
  if (stabilityMs > 0) plan.push(stabilityStep(stabilityMs));
  plan.push(
    serviceStep('cleanup-stop-backend', 'stop', 'backend', 'backend stops before core during cleanup'),
    serviceStep('cleanup-stop-core', 'stop', 'core', 'core stops last during cleanup'),
  );
  return plan;
};

const indexOf = (plan, id) => plan.findIndex((step) => step.id === id);

export const validateSplitLifecyclePlan = (plan) => {
  const failures = [];
  for (const id of splitLifecycleStepIds) {
    if (indexOf(plan, id) === -1) failures.push(`missing-step:${id}`);
  }
  for (const step of plan) {
    if (step.kind !== 'service-command' && step.kind !== 'health-check' && step.kind !== 'stability-hold') {
      failures.push(`unsupported-step-kind:${step.id}`);
    }
    if (step.command && !step.command.args.includes('-Mode')) failures.push(`missing-mode:${step.id}`);
    if (step.command && !step.command.args.includes('split')) failures.push(`missing-split:${step.id}`);
  }
  if (indexOf(plan, 'start-core') > indexOf(plan, 'start-backend')) failures.push('core-must-start-before-backend');
  if (indexOf(plan, 'restart-backend-stop') > indexOf(plan, 'restart-backend-start')) {
    failures.push('backend-restart-order');
  }
  if (indexOf(plan, 'restart-core-stop') > indexOf(plan, 'restart-core-start')) failures.push('core-restart-order');
  if (indexOf(plan, 'cleanup-stop-backend') > indexOf(plan, 'cleanup-stop-core')) {
    failures.push('cleanup-must-stop-backend-before-core');
  }
  return {
    ok: failures.length === 0,
    failures,
  };
};
