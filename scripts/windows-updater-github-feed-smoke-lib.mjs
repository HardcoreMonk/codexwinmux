const requireValue = (name, value) => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`GitHub updater feed ${name} is required.`);
  }
  return value.trim();
};

const summarizeCommandResult = (result) => {
  if (!result) return null;
  return {
    exitCode: result.exitCode,
    signal: result.signal ?? null,
    timedOut: !!result.timedOut,
  };
};

export const buildWindowsUpdaterGitHubFeedUrl = ({ owner, repo, tag }) => {
  const resolvedOwner = encodeURIComponent(requireValue('owner', owner));
  const resolvedRepo = encodeURIComponent(requireValue('repo', repo));
  const resolvedTag = encodeURIComponent(requireValue('tag', tag));
  return `https://github.com/${resolvedOwner}/${resolvedRepo}/releases/download/${resolvedTag}/`;
};

export const buildWindowsUpdaterGitHubFeedArtifactPayload = ({
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
  blockers: Array.isArray(blockers) ? blockers : statusSummary?.blockers ?? [],
  latestVersion: statusSummary?.latestVersion ?? null,
  downloadedFileName: statusSummary?.downloadedFileName ?? null,
  installResult: summarizeCommandResult(installResult),
  updateLaunchResult: summarizeCommandResult(updateLaunchResult),
  postInstallLaunchResult: summarizeCommandResult(postInstallLaunchResult),
  uninstallResult: summarizeCommandResult(uninstallResult),
});
