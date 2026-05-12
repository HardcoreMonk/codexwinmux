const normalizeText = (value) => (typeof value === 'string' ? value.trim() : '');

const toBlocker = (ruleId, message, extra = {}) => ({
  ruleId,
  message,
  ...extra,
});

export const buildReleaseTag = (packageVersion) => `v${normalizeText(packageVersion)}`;

export const evaluateReleaseImmutability = ({
  packageVersion,
  localTagCommit = null,
  remoteTagCommit = null,
  githubReleaseUrl = null,
} = {}) => {
  const tag = buildReleaseTag(packageVersion);
  const checks = [];
  const blockers = [];

  if (!normalizeText(packageVersion)) {
    blockers.push(toBlocker(
      'release-immutability-version-missing',
      'package.json version is required before release publication.',
    ));
  }

  if (normalizeText(localTagCommit)) {
    blockers.push(toBlocker(
      'release-immutability-local-tag-exists',
      'The current package version already has a local git tag; bump the version instead of republishing.',
      { tag, commit: normalizeText(localTagCommit) },
    ));
  } else {
    checks.push('release-immutability-local-tag-available');
  }

  if (normalizeText(remoteTagCommit)) {
    blockers.push(toBlocker(
      'release-immutability-remote-tag-exists',
      'The current package version already has a remote git tag; bump the version instead of moving the tag.',
      { tag, commit: normalizeText(remoteTagCommit) },
    ));
  } else {
    checks.push('release-immutability-remote-tag-available');
  }

  if (normalizeText(githubReleaseUrl)) {
    blockers.push(toBlocker(
      'release-immutability-github-release-exists',
      'The current package version already has a GitHub Release; publish the next version instead of clobbering assets.',
      { tag, url: normalizeText(githubReleaseUrl) },
    ));
  } else {
    checks.push('release-immutability-github-release-available');
  }

  return {
    ok: blockers.length === 0,
    mutatesSystem: false,
    tag,
    checks,
    blockers,
  };
};

export const buildReleaseImmutabilityArtifactPayload = (result) => ({
  ok: result.ok === true,
  mutatesSystem: false,
  tag: result.tag,
  checks: result.checks,
  blockers: result.blockers,
});
