const normalizeText = (value) => (typeof value === 'string' ? value.trim() : '');
const DEFAULT_MINIMUM_PACKAGE_VERSION = '0.4.15';

const toBlocker = (ruleId, message, extra = {}) => ({
  ruleId,
  message,
  ...extra,
});

const parseSemverCore = (value) => {
  const match = normalizeText(value).match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (!match) return null;
  return match.slice(1, 4).map((part) => Number(part));
};

const compareSemverCore = (left, right) => {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
};

export const buildReleaseTag = (packageVersion) => `v${normalizeText(packageVersion)}`;

export const evaluateReleaseImmutability = ({
  packageVersion,
  localTagCommit = null,
  remoteTagCommit = null,
  githubReleaseUrl = null,
  minimumPackageVersion = DEFAULT_MINIMUM_PACKAGE_VERSION,
} = {}) => {
  const tag = buildReleaseTag(packageVersion);
  const checks = [];
  const blockers = [];
  const normalizedVersion = normalizeText(packageVersion);
  const normalizedMinimum = normalizeText(minimumPackageVersion);

  if (!normalizedVersion) {
    blockers.push(toBlocker(
      'release-immutability-version-missing',
      'package.json version is required before release publication.',
    ));
  } else {
    const versionParts = parseSemverCore(normalizedVersion);
    const minimumParts = parseSemverCore(normalizedMinimum);
    if (versionParts && minimumParts && compareSemverCore(versionParts, minimumParts) < 0) {
      blockers.push(toBlocker(
        'release-immutability-version-below-minimum',
        `The next codexwinmux release must be ${normalizedMinimum} or newer; do not reuse v0.4.14 tags or assets.`,
        { packageVersion: normalizedVersion, minimumPackageVersion: normalizedMinimum },
      ));
    } else if (minimumParts) {
      checks.push('release-immutability-version-floor-satisfied');
    }
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
