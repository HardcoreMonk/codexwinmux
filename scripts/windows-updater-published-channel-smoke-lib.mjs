const latestYamlAssetName = 'latest.yml';

const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;

const normalizeArtifactName = (value) => {
  if (typeof value !== 'string') return null;
  const name = value.replace(/\\/g, '/').split('/').pop()?.trim();
  return name || null;
};

const normalizeReleaseAssets = (assets) =>
  (Array.isArray(assets) ? assets : [])
    .map((asset) => ({
      name: normalizeArtifactName(asset?.name),
      size: Number.isFinite(asset?.size) ? asset.size : null,
      browserDownloadUrl: isNonEmptyString(asset?.browser_download_url)
        ? asset.browser_download_url
        : isNonEmptyString(asset?.browserDownloadUrl)
          ? asset.browserDownloadUrl
          : null,
    }))
    .filter((asset) => asset.name);

const buildAssetIndex = (assets) => {
  const index = new Map();
  for (const asset of normalizeReleaseAssets(assets)) {
    index.set(asset.name.toLowerCase(), asset);
  }
  return index;
};

const addBlocker = (blockers, ruleId, message, extra = {}) => {
  blockers.push({ ruleId, message, ...extra });
};

const parseSemver = (version) => {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(version || '').trim());
  if (!match) return null;
  return match.slice(1).map((part) => Number(part));
};

export const compareSemver = (left, right) => {
  const leftParts = parseSemver(left);
  const rightParts = parseSemver(right);
  if (!leftParts || !rightParts) return null;
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] > rightParts[index]) return 1;
    if (leftParts[index] < rightParts[index]) return -1;
  }
  return 0;
};

export const resolveWindowsPublishedUpdateCurrentVersion = ({
  env = process.env,
  packageVersion,
} = {}) =>
  isNonEmptyString(env.CODEXMUX_WINDOWS_UPDATER_CURRENT_VERSION)
    ? env.CODEXMUX_WINDOWS_UPDATER_CURRENT_VERSION.trim()
    : packageVersion;

const publishedAtTime = (release) => {
  const value = Date.parse(release?.published_at || release?.publishedAt || '');
  return Number.isFinite(value) ? value : 0;
};

export const selectLatestPublishedRelease = ({
  releases,
  includePrerelease = false,
} = {}) => {
  const published = (Array.isArray(releases) ? releases : [])
    .filter((release) => release && release.draft !== true)
    .filter((release) => includePrerelease || release.prerelease !== true);

  if (published.length === 0) return null;

  return [...published].sort((a, b) => publishedAtTime(b) - publishedAtTime(a))[0];
};

const getMetadataFileEntries = (latestMetadata) =>
  Array.isArray(latestMetadata?.files) ? latestMetadata.files : [];

const findInstallerMetadataEntry = ({ latestMetadata, pathName }) => {
  const entries = getMetadataFileEntries(latestMetadata);
  if (entries.length === 0) return null;
  if (!pathName) return entries[0];

  return entries.find((entry) => normalizeArtifactName(entry?.url)?.toLowerCase() === pathName.toLowerCase())
    ?? entries[0];
};

export const evaluateWindowsPublishedUpdateChannel = ({
  releases,
  currentVersion,
  latestMetadata,
  includePrerelease = false,
} = {}) => {
  const blockers = [];
  const checks = [];
  const latestRelease = selectLatestPublishedRelease({ releases, includePrerelease });
  const releaseCount = Array.isArray(releases) ? releases.length : 0;

  if (!latestRelease) {
    addBlocker(
      blockers,
      'windows-published-release-missing',
      'No published GitHub release was found for the Windows updater channel.',
    );
    return {
      ok: false,
      mutatesSystem: false,
      currentVersion: currentVersion ?? null,
      latestVersion: null,
      latestReleaseTag: null,
      latestReleaseUrl: null,
      releaseCount,
      referencedInstallerName: null,
      checks,
      blockers,
    };
  }

  checks.push('windows-published-release-present');

  const assetIndex = buildAssetIndex(latestRelease.assets);
  const latestYamlAsset = assetIndex.get(latestYamlAssetName);
  if (latestYamlAsset) {
    checks.push('windows-published-latest-yml-asset-present');
  } else {
    addBlocker(
      blockers,
      'windows-published-latest-yml-asset-missing',
      'The latest published release must include latest.yml for electron-updater.',
    );
  }

  if (!latestMetadata || typeof latestMetadata !== 'object') {
    addBlocker(
      blockers,
      'windows-published-latest-yml-unavailable',
      'latest.yml must be readable from the published release asset.',
    );
    return {
      ok: false,
      mutatesSystem: false,
      currentVersion: currentVersion ?? null,
      latestVersion: null,
      latestReleaseTag: latestRelease.tag_name ?? null,
      latestReleaseUrl: latestRelease.html_url ?? null,
      releaseCount,
      referencedInstallerName: null,
      checks,
      blockers,
    };
  }

  const latestVersion = isNonEmptyString(latestMetadata.version) ? latestMetadata.version : null;
  if (latestVersion) {
    checks.push('windows-published-version-present');
  } else {
    addBlocker(
      blockers,
      'windows-published-version-missing',
      'Published latest.yml must include a release version.',
    );
  }

  if (currentVersion && latestVersion) {
    const comparison = compareSemver(latestVersion, currentVersion);
    if (comparison === null) {
      addBlocker(
        blockers,
        'windows-published-version-unparseable',
        'Published latest.yml version and current package version must be semver.',
        { currentVersion, latestVersion },
      );
    } else if (comparison > 0) {
      checks.push('windows-published-version-newer-than-current');
    } else {
      addBlocker(
        blockers,
        'windows-published-version-not-newer',
        'Published latest.yml version must be newer than the installed/current version for update evidence.',
        { currentVersion, latestVersion },
      );
    }
  }

  const pathName = normalizeArtifactName(latestMetadata.path);
  const metadataEntry = findInstallerMetadataEntry({ latestMetadata, pathName });
  const entryName = normalizeArtifactName(metadataEntry?.url);
  const referencedInstallerName = pathName || entryName;
  const installerAsset = referencedInstallerName
    ? assetIndex.get(referencedInstallerName.toLowerCase())
    : null;

  if (!referencedInstallerName) {
    addBlocker(
      blockers,
      'windows-published-installer-reference-missing',
      'Published latest.yml must reference the NSIS installer artifact.',
    );
  } else if (installerAsset) {
    checks.push('windows-published-installer-asset-present');
  } else {
    addBlocker(
      blockers,
      'windows-published-installer-asset-missing',
      'The published release must include the NSIS installer referenced by latest.yml.',
      { fileName: referencedInstallerName },
    );
  }

  if (installerAsset && Number.isFinite(metadataEntry?.size)) {
    if (installerAsset.size === metadataEntry.size) {
      checks.push('windows-published-installer-size-matches');
    } else {
      addBlocker(
        blockers,
        'windows-published-installer-size-mismatch',
        'Published latest.yml installer size must match the GitHub release asset size.',
        {
          expectedSize: metadataEntry.size,
          actualSize: installerAsset.size,
        },
      );
    }
  } else if (installerAsset) {
    addBlocker(
      blockers,
      'windows-published-installer-size-missing',
      'Published latest.yml file entry must include the installer size.',
    );
  }

  const latestSha = latestMetadata?.sha512;
  const fileSha = metadataEntry?.sha512;
  if (isNonEmptyString(latestSha) && isNonEmptyString(fileSha)) {
    if (latestSha === fileSha) {
      checks.push('windows-published-sha512-present');
    } else {
      addBlocker(
        blockers,
        'windows-published-sha512-mismatch',
        'Published latest.yml top-level sha512 and file entry sha512 must match.',
      );
    }
  } else {
    addBlocker(
      blockers,
      'windows-published-sha512-missing',
      'Published latest.yml must include sha512 metadata for the installer.',
    );
  }

  const blockmapAsset = referencedInstallerName
    ? assetIndex.get(`${referencedInstallerName}.blockmap`.toLowerCase())
    : null;
  if (blockmapAsset) {
    checks.push('windows-published-blockmap-asset-present');
  } else if (referencedInstallerName) {
    addBlocker(
      blockers,
      'windows-published-blockmap-asset-missing',
      'The published release must include the NSIS blockmap that matches the installer artifact.',
      { fileName: `${referencedInstallerName}.blockmap` },
    );
  }

  const downloadAssets = [latestYamlAsset, installerAsset, blockmapAsset].filter(Boolean);
  if (downloadAssets.length === 3 && downloadAssets.every((asset) => isNonEmptyString(asset.browserDownloadUrl))) {
    checks.push('windows-published-download-urls-present');
  } else {
    addBlocker(
      blockers,
      'windows-published-download-url-missing',
      'Published latest.yml, installer, and blockmap assets must expose download URLs.',
    );
  }

  return {
    ok: blockers.length === 0,
    mutatesSystem: false,
    currentVersion: currentVersion ?? null,
    latestVersion,
    latestReleaseTag: latestRelease.tag_name ?? null,
    latestReleaseUrl: latestRelease.html_url ?? null,
    releaseCount,
    referencedInstallerName: referencedInstallerName ?? null,
    checks,
    blockers,
  };
};

export const buildWindowsPublishedUpdateArtifactPayload = (result) => ({
  ok: result.ok === true,
  mutatesSystem: false,
  currentVersion: result.currentVersion ?? null,
  latestVersion: result.latestVersion ?? null,
  latestReleaseTag: result.latestReleaseTag ?? null,
  latestReleaseUrl: result.latestReleaseUrl ?? null,
  releaseCount: Number.isFinite(result.releaseCount) ? result.releaseCount : null,
  referencedInstallerName: result.referencedInstallerName ?? null,
  checks: Array.isArray(result.checks) ? result.checks : [],
  blockers: Array.isArray(result.blockers) ? result.blockers : [],
});
