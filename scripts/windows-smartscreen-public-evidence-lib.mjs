const normalizeText = (value) => (typeof value === 'string' ? value.trim() : '');

const normalizeUrl = (value) => {
  const text = normalizeText(value);
  if (!text) return null;
  try {
    const url = new URL(text);
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
};

const normalizeZoneId = (value) => {
  const zoneId = Number(value);
  return Number.isFinite(zoneId) ? zoneId : null;
};

const normalizeLaunch = (launch = {}) => ({
  started: launch.started === true,
  exitCode: Number.isFinite(launch.exitCode) ? launch.exitCode : null,
  timedOut: launch.timedOut === true,
});

export const buildWindowsSmartScreenPublicEvidence = ({
  artifactSha256,
  checkedAt = new Date().toISOString(),
  downloadUrl,
  environment = 'clean-windows-public-download',
  launch,
  zoneId,
} = {}) => {
  const normalizedLaunch = normalizeLaunch(launch);
  return {
    status: 'passed',
    checkedAt,
    environment,
    verificationMethod: 'windows-smartscreen-public-launch-smoke',
    artifactSha256: normalizeText(artifactSha256) || null,
    download: {
      url: normalizeUrl(downloadUrl),
      zoneId: normalizeZoneId(zoneId),
    },
    launch: normalizedLaunch,
  };
};

export const hasWindowsSmartScreenPublicLaunchEvidence = (evidence) => {
  if (!evidence || evidence.verificationMethod !== 'windows-smartscreen-public-launch-smoke') return false;
  if (normalizeText(evidence.status).toLowerCase() !== 'passed') return false;
  if (!normalizeUrl(evidence.download?.url)) return false;
  if (normalizeZoneId(evidence.download?.zoneId) !== 3) return false;

  const launch = normalizeLaunch(evidence.launch);
  return launch.started === true && launch.exitCode === 0 && launch.timedOut === false;
};

export const buildWindowsSmartScreenPublicEvidencePayload = ({
  ok,
  checks = [],
  blockers = [],
  evidence = null,
  downloadFileName = null,
} = {}) => ({
  ok: ok === true,
  mutatesSystem: true,
  checks,
  blockers,
  evidence,
  downloadFileName,
});
