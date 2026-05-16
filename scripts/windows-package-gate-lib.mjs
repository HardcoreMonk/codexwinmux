import { runPackageScriptStep } from './windows-release-gate-lib.mjs';

export const getWindowsPackageGateSteps = () => [
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
    isolateInstalledServices: true,
  },
  {
    id: 'windows-packaged-launch',
    script: 'smoke:windows:packaged-launch',
    isolateInstalledServices: true,
  },
  {
    id: 'windows-engine-lifecycle',
    script: 'smoke:windows:engine-lifecycle',
    isolateInstalledServices: true,
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
    id: 'windows-packaged-runtime-v2',
    script: 'smoke:windows:packaged-runtime-v2',
    isolateInstalledServices: true,
  },
  {
    id: 'windows-installer-runtime-v2',
    script: 'smoke:windows:installer-runtime-v2',
    isolateInstalledServices: true,
  },
];

export const getWindowsPackageGateServiceIsolationSteps = () => ({
  stop: {
    id: 'windows-service-account-stop-services',
    script: 'windows:service-account:stop-services',
  },
  restart: {
    id: 'windows-service-account-restart-services',
    script: 'windows:service-account:restart-services',
  },
});

export const validateWindowsPackageGatePackageScripts = ({ scripts }) => {
  const requiredScripts = getWindowsPackageGateSteps().map((step) => step.script);
  const missingScriptIds = requiredScripts.filter((script) => typeof scripts?.[script] !== 'string');

  return {
    ok: missingScriptIds.length === 0,
    missingScriptIds,
  };
};

export const runWindowsPackageGate = async ({
  steps = getWindowsPackageGateSteps(),
  runStep = runPackageScriptStep,
  serviceIsolationSteps = getWindowsPackageGateServiceIsolationSteps(),
  serviceIsolationEnabled = process.platform === 'win32'
    && process.env.CODEXWINMUX_WINDOWS_PACKAGE_GATE_SERVICE_ISOLATION !== '0',
} = {}) => {
  const results = [];
  let servicesStoppedForIsolation = false;
  let failedStepId = null;

  const runAndRecord = async (step) => {
    const result = await runStep(step);
    results.push({
      id: step.id,
      script: step.script,
      ...result,
    });
    return result;
  };

  for (const step of steps) {
    if (serviceIsolationEnabled && step.isolateInstalledServices && !servicesStoppedForIsolation) {
      const stopResult = await runAndRecord(serviceIsolationSteps.stop);
      if (!stopResult.ok) {
        return {
          ok: false,
          failedStepId: serviceIsolationSteps.stop.id,
          results,
        };
      }
      servicesStoppedForIsolation = true;
    }

    const result = await runAndRecord(step);
    if (!result.ok) {
      failedStepId = step.id;
      break;
    }
  }

  if (servicesStoppedForIsolation) {
    const restartResult = await runAndRecord(serviceIsolationSteps.restart);
    if (!restartResult.ok && !failedStepId) {
      failedStepId = serviceIsolationSteps.restart.id;
    }
  }

  if (failedStepId) {
    return {
      ok: false,
      failedStepId,
      results,
    };
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

const sanitizePackageGateResult = (result) =>
  Object.fromEntries(
    Object.entries(result).filter(([key]) => allowedResultKeys.has(key)),
  );

export const buildWindowsPackageGateArtifactPayload = ({
  result,
  durationMs,
}) => ({
  ok: result.ok,
  mutatesSystem: true,
  durationMs,
  failedStepId: result.failedStepId,
  results: result.results.map(sanitizePackageGateResult),
});
