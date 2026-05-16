import { spawn } from 'child_process';
import { buildNodeWarningPolicyEnv } from './node-warning-policy-lib.mjs';

export const getWindowsReleaseGateSteps = () => [
  {
    id: 'windows-platform-audit',
    script: 'audit:windows-platform',
  },
  {
    id: 'windows-runtime-v2-terminal',
    script: 'smoke:runtime-v2:terminal-windows',
  },
  {
    id: 'windows-preflight',
    script: 'smoke:windows:preflight',
  },
  {
    id: 'windows-service-host',
    script: 'smoke:windows:service-host',
  },
  {
    id: 'windows-core-engine-ipc',
    script: 'smoke:windows:core-engine-ipc',
  },
  {
    id: 'windows-core-backend-external-transport',
    script: 'smoke:windows:core-backend-external-transport',
  },
  {
    id: 'windows-core-backend-split-lifecycle',
    script: 'smoke:windows:core-backend-split-lifecycle',
  },
  {
    id: 'windows-host-diagnostics',
    script: 'smoke:windows:host-diagnostics',
  },
  {
    id: 'windows-electron-env',
    script: 'smoke:windows:electron-env',
  },
  {
    id: 'windows-electron-packaging',
    script: 'smoke:windows:electron-packaging',
  },
  {
    id: 'windows-codex-session',
    script: 'smoke:windows:codex-session',
  },
];

export const validateWindowsReleaseGatePackageScripts = ({ scripts }) => {
  const requiredScripts = getWindowsReleaseGateSteps().map((step) => step.script);
  const missingScriptIds = requiredScripts.filter((script) => typeof scripts?.[script] !== 'string');

  return {
    ok: missingScriptIds.length === 0,
    missingScriptIds,
  };
};

export const buildPackageScriptEnv = ({ env = process.env } = {}) =>
  buildNodeWarningPolicyEnv({ env });

export const runPackageScriptStep = (
  step,
  {
    cwd = process.cwd(),
    env = process.env,
    stdio = 'inherit',
  } = {},
) => {
  const startedAt = Date.now();
  const isWindows = process.platform === 'win32';
  const command = isWindows ? (process.env.ComSpec || 'cmd.exe') : 'corepack';
  const args = isWindows
    ? ['/d', '/s', '/c', `corepack pnpm ${step.script}`]
    : ['pnpm', step.script];

  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, {
        cwd,
        env: buildPackageScriptEnv({ env }),
        stdio,
        windowsHide: true,
      });
    } catch (err) {
      resolve({
        ok: false,
        durationMs: Date.now() - startedAt,
        exitCode: null,
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    child.on('error', (err) => {
      resolve({
        ok: false,
        durationMs: Date.now() - startedAt,
        exitCode: null,
        error: err.message,
      });
    });

    child.on('close', (code, signal) => {
      resolve({
        ok: code === 0,
        durationMs: Date.now() - startedAt,
        exitCode: code,
        signal,
      });
    });
  });
};

export const runWindowsReleaseGate = async ({
  steps = getWindowsReleaseGateSteps(),
  runStep = runPackageScriptStep,
} = {}) => {
  const results = [];

  for (const step of steps) {
    const result = await runStep(step);
    results.push({
      id: step.id,
      script: step.script,
      ...result,
    });

    if (!result.ok) {
      return {
        ok: false,
        failedStepId: step.id,
        results,
      };
    }
  }

  return {
    ok: true,
    failedStepId: null,
    results,
  };
};

const allowedResultKeys = new Set([
  'id',
  'script',
  'ok',
  'durationMs',
  'exitCode',
  'signal',
  'error',
]);

const sanitizeReleaseGateResult = (result) =>
  Object.fromEntries(
    Object.entries(result).filter(([key]) => allowedResultKeys.has(key)),
  );

export const buildWindowsReleaseGateArtifactPayload = ({
  result,
  durationMs,
}) => ({
  ok: result.ok,
  mutatesSystem: false,
  durationMs,
  failedStepId: result.failedStepId,
  results: result.results.map(sanitizeReleaseGateResult),
});
