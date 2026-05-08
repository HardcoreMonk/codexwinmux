const summarizeState = (state) => {
  if (!state || typeof state !== 'object') return null;
  return {
    title: state.title,
    readyState: state.readyState,
    hasElectronApi: state.hasElectronApi,
    electronApiKeys: Array.isArray(state.electronApiKeys) ? state.electronApiKeys : [],
    hasPasswordInput: state.hasPasswordInput,
    userAgent: state.userAgent,
  };
};

const summarizeHealth = (health) => {
  if (!health || typeof health !== 'object') return null;
  return {
    app: health.app,
    version: health.version,
    commit: health.commit,
    buildTime: health.buildTime,
  };
};

const summarizeRuntimeV2Terminal = (runtimeV2Terminal) => {
  if (!runtimeV2Terminal) return null;
  return {
    verified: true,
    runtimeVersion: runtimeV2Terminal.runtimeVersion,
  };
};

const summarizeEngineLifecycle = (engineLifecycleEvidence) => {
  if (!engineLifecycleEvidence || typeof engineLifecycleEvidence !== 'object') return null;
  return {
    uiQuitRequested: engineLifecycleEvidence.uiQuitRequested === true,
    uiExited: engineLifecycleEvidence.uiExited === true,
    uiExitCode: Number.isFinite(engineLifecycleEvidence.uiExitCode) ? engineLifecycleEvidence.uiExitCode : null,
    uiExitSignal: engineLifecycleEvidence.uiExitSignal ?? null,
    healthAfterUiQuit: summarizeHealth(engineLifecycleEvidence.healthAfterUiQuit),
  };
};

const summarizeCommandResult = (result) => {
  if (!result || typeof result !== 'object') return null;
  return {
    exitCode: result.exitCode,
    signal: result.signal ?? null,
    timedOut: !!result.timedOut,
  };
};

export const buildWindowsPackagedLaunchArtifactPayload = (payload) => ({
  ok: payload?.ok === true,
  ...(payload?.code ? { code: payload.code } : {}),
  ...(payload?.message ? { message: payload.message } : {}),
  mutatesSystem: payload?.mutatesSystem === true,
  ...(payload?.runtimeV2TerminalRequested !== undefined
    ? { runtimeV2TerminalRequested: payload.runtimeV2TerminalRequested === true }
    : {}),
  ...(payload?.engineLifecycleRequested !== undefined
    ? { engineLifecycleRequested: payload.engineLifecycleRequested === true }
    : {}),
  ...(payload?.engineLifecycle !== undefined
    ? { engineLifecycle: payload.engineLifecycle === true }
    : {}),
  launchMode: payload?.launchMode ?? null,
  longRunHoldMs: Number.isFinite(payload?.longRunHoldMs) ? payload.longRunHoldMs : 0,
  checks: Array.isArray(payload?.checks) ? payload.checks : [],
  state: summarizeState(payload?.state),
  health: summarizeHealth(payload?.health),
  longRunHealth: summarizeHealth(payload?.longRunHealth),
  engineLifecycleEvidence: summarizeEngineLifecycle(payload?.engineLifecycleEvidence),
  runtimeV2Terminal: summarizeRuntimeV2Terminal(payload?.runtimeV2Terminal),
  consoleEventCount: Number.isFinite(payload?.consoleEventCount) ? payload.consoleEventCount : null,
  blockingConsoleCount: Number.isFinite(payload?.blockingConsoleCount) ? payload.blockingConsoleCount : null,
});

export const buildWindowsInstallerArtifactPayload = (payload) => ({
  ok: payload?.ok === true,
  ...(payload?.code ? { code: payload.code } : {}),
  ...(payload?.message ? { message: payload.message } : {}),
  mutatesSystem: payload?.mutatesSystem === true,
  ...(payload?.runtimeV2TerminalRequested !== undefined
    ? { runtimeV2TerminalRequested: payload.runtimeV2TerminalRequested === true }
    : {}),
  checks: Array.isArray(payload?.checks) ? payload.checks : [],
  runtimeV2Terminal: payload?.runtimeV2Terminal === true,
  launch: payload?.launch ? buildWindowsPackagedLaunchArtifactPayload(payload.launch) : null,
  installResult: summarizeCommandResult(payload?.installResult),
  launchResult: summarizeCommandResult(payload?.launchResult),
  uninstallResult: summarizeCommandResult(payload?.uninstallResult),
});
