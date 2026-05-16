import path from 'node:path';

export const coreEngineIpcSmokeTimeoutMs = 15_000;

export const buildCoreEngineIpcLaunchPlan = ({
  cwd = process.cwd(),
  env = process.env,
} = {}) => {
  const scriptPath = env.CODEXWINMUX_CORE_ENGINE_HOST_SCRIPT
    || path.join(cwd, 'dist', 'workers', 'core-engine-host.js');
  return {
    scriptPath,
    cwd,
    command: process.execPath,
    args: [scriptPath],
    env: {
      CODEXWINMUX_RUNTIME_V2: '1',
      CODEXWINMUX_RUNTIME_TERMINAL_ADAPTER: env.CODEXWINMUX_RUNTIME_TERMINAL_ADAPTER || 'windows',
      CODEXWINMUX_PROCESS_INSPECTOR_ADAPTER: env.CODEXWINMUX_PROCESS_INSPECTOR_ADAPTER || 'windows',
    },
  };
};

export const createCoreHealthCommand = (id = 'smoke-core-health') => ({
  kind: 'command',
  id,
  source: 'backend',
  target: 'core',
  type: 'core.health',
  payload: {},
});

export const summarizeCoreHealthReply = (message) => {
  const payload = message?.payload;
  const runtime = payload?.runtime && typeof payload.runtime === 'object' ? payload.runtime : {};
  return {
    ok: payload?.ok === true,
    runtimeOk: runtime.ok === true,
    workers: {
      storage: runtime.storage && typeof runtime.storage === 'object' ? runtime.storage.ok === true : null,
      terminal: runtime.terminal && typeof runtime.terminal === 'object' ? runtime.terminal.ok === true : null,
      timeline: runtime.timeline && typeof runtime.timeline === 'object' ? runtime.timeline.ok === true : null,
      status: runtime.status && typeof runtime.status === 'object' ? runtime.status.ok === true : null,
    },
  };
};

export const buildCoreEngineIpcSmokePayload = ({
  ok,
  eventReceived,
  reply,
  exitCode = null,
  signal = null,
  error = null,
}) => ({
  ok: ok === true,
  mutatesSystem: false,
  checks: [
    ...(eventReceived ? ['core-health-event'] : []),
    ...(reply ? ['core-health-reply'] : []),
  ],
  health: reply ? summarizeCoreHealthReply(reply) : null,
  exitCode,
  signal,
  ...(error ? { error } : {}),
});
