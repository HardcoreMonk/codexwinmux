import path from 'path';
import { preferredCodexwinmuxEnvKey } from './env-alias-lib.mjs';

const requiredInstallEvents = [
  {
    event: 'configured',
    check: 'updater-local-feed-configured',
    blocker: 'updater-local-feed-configured-missing',
  },
  {
    event: 'checking-for-update',
    check: 'updater-check-started',
    blocker: 'updater-check-started-missing',
  },
  {
    event: 'update-available',
    check: 'updater-update-available',
    blocker: 'updater-update-available-missing',
  },
  {
    event: 'download-started',
    check: 'updater-download-started',
    blocker: 'updater-download-started-missing',
  },
  {
    event: 'download-progress',
    check: 'updater-download-progress',
    blocker: null,
  },
  {
    event: 'update-downloaded',
    check: 'updater-update-downloaded',
    blocker: 'updater-update-downloaded-missing',
  },
  {
    event: 'quit-and-install-started',
    check: 'updater-quit-and-install-started',
    blocker: 'updater-quit-and-install-started-missing',
  },
];

export const bumpPatchVersion = (version) => {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(version || '').trim());
  if (!match) throw new Error('A valid x.y.z version is required for updater local feed smoke.');
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
};

export const buildWindowsUpdaterLocalFeedLatestMetadata = ({
  latestMetadata,
  nextVersion,
  releaseDate = new Date().toISOString(),
}) => ({
  ...latestMetadata,
  version: nextVersion,
  files: Array.isArray(latestMetadata?.files)
    ? latestMetadata.files.map((file) => ({ ...file }))
    : latestMetadata?.files,
  releaseDate,
});

const buildEnvAlias = (legacyKey, value) => ({
  [preferredCodexwinmuxEnvKey(legacyKey)]: value,
  [legacyKey]: value,
});

export const buildWindowsUpdaterSmokeEnv = ({
  env = process.env,
  feedUrl,
  statusPath,
  installDir,
  homeDir,
}) => ({
  ...Object.fromEntries(Object.entries(env).filter(([key]) => key !== 'NODE_OPTIONS')),
  HOME: homeDir,
  USERPROFILE: homeDir,
  APPDATA: path.win32.join(homeDir, 'AppData', 'Roaming'),
  LOCALAPPDATA: path.win32.join(homeDir, 'AppData', 'Local'),
  ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
  ELECTRON_DISABLE_SANDBOX: '1',
  NODE_NO_WARNINGS: '1',
  NEXT_TELEMETRY_DISABLED: '1',
  NO_AT_BRIDGE: '1',
  ...buildEnvAlias('CODEXMUX_RUNTIME_V2', '1'),
  ...buildEnvAlias('CODEXMUX_RUNTIME_TERMINAL_V2_MODE', 'new-tabs'),
  ...buildEnvAlias('CODEXMUX_RUNTIME_TERMINAL_ADAPTER', 'windows'),
  ...buildEnvAlias('CODEXMUX_PROCESS_INSPECTOR_ADAPTER', 'windows'),
  CODEXMUX_ELECTRON_UPDATER_FEED_URL: feedUrl,
  CODEXMUX_ELECTRON_UPDATER_SMOKE: '1',
  CODEXMUX_ELECTRON_UPDATER_SMOKE_STATUS_PATH: statusPath,
  CODEXMUX_ELECTRON_UPDATER_SMOKE_AUTO_DOWNLOAD: '1',
  CODEXMUX_ELECTRON_UPDATER_SMOKE_AUTO_INSTALL: '1',
  CODEXMUX_ELECTRON_UPDATER_SMOKE_INSTALL_DIR: installDir,
  CODEXMUX_ELECTRON_UPDATER_DISABLE_DIFFERENTIAL: '1',
});

export const parseWindowsUpdaterStatusEvents = (content) =>
  String(content || '')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));

const addBlocker = (blockers, ruleId, message) => {
  blockers.push({ ruleId, message });
};

export const summarizeWindowsUpdaterStatusEvents = (events) => {
  const list = Array.isArray(events) ? events : [];
  const eventNames = new Set(list.map((event) => event?.event));
  const checks = [];
  const blockers = [];

  for (const requirement of requiredInstallEvents) {
    if (eventNames.has(requirement.event)) {
      checks.push(requirement.check);
    } else if (requirement.blocker) {
      addBlocker(
        blockers,
        requirement.blocker,
        `Updater local feed smoke did not observe ${requirement.event}.`,
      );
    }
  }

  const errorEvent = list.find((event) => event?.event === 'error');
  if (errorEvent) {
    addBlocker(
      blockers,
      'updater-error-event',
      errorEvent.error || 'Updater emitted an error event.',
    );
  }

  const updateAvailable = list.find((event) => event?.event === 'update-available');
  const downloaded = list.find((event) => event?.event === 'update-downloaded');

  return {
    ok: blockers.length === 0,
    latestVersion: downloaded?.version ?? updateAvailable?.version ?? null,
    downloadedFileName: downloaded?.downloadedFileName ?? null,
    checks,
    blockers,
  };
};

const summarizeCommandResult = (result) => {
  if (!result) return null;
  return {
    exitCode: result.exitCode,
    signal: result.signal ?? null,
    timedOut: !!result.timedOut,
  };
};

export const buildWindowsUpdaterLocalFeedArtifactPayload = ({
  ok,
  checks,
  blockers = [],
  statusSummary,
  installResult,
  updateLaunchResult,
  postInstallLaunchResult,
  uninstallResult,
}) => ({
  ok: ok === true,
  mutatesSystem: true,
  checks: Array.isArray(checks) ? checks : [],
  blockers: Array.isArray(blockers) ? blockers : [],
  latestVersion: statusSummary?.latestVersion ?? null,
  downloadedFileName: statusSummary?.downloadedFileName ?? null,
  installResult: summarizeCommandResult(installResult),
  updateLaunchResult: summarizeCommandResult(updateLaunchResult),
  postInstallLaunchResult: summarizeCommandResult(postInstallLaunchResult),
  uninstallResult: summarizeCommandResult(uninstallResult),
});
