const requiredArtifactIds = new Set(['installer', 'unpacked-exe']);

const normalizeText = (value) => (typeof value === 'string' ? value.trim() : '');

const toBlocker = (ruleId, message, artifactId = null) => ({
  ruleId,
  message,
  ...(artifactId ? { artifactId } : {}),
});

const hasSigner = (signature) =>
  Boolean(normalizeText(signature?.signerSubject) || normalizeText(signature?.signerThumbprint));

const hasTimestamp = (signature) =>
  Boolean(normalizeText(signature?.timeStamperSubject) || normalizeText(signature?.timeStamperThumbprint));

const hasValidSignature = (signature) =>
  normalizeText(signature?.status) === 'Valid' &&
  normalizeText(signature?.signatureType) === 'Authenticode' &&
  hasSigner(signature);

const internalSmartScreenStatuses = new Set(['internal-not-required', 'internal-trusted-root']);

const sanitizeArtifactForPayload = (artifact) => ({
  id: artifact.id,
  fileName: artifact.fileName,
  exists: artifact.exists === true,
  sizeBytes: Number.isFinite(artifact.sizeBytes) ? artifact.sizeBytes : null,
  sha256: normalizeText(artifact.sha256) || null,
  signatureStatus: normalizeText(artifact.signature?.status) || 'Unknown',
  signatureType: normalizeText(artifact.signature?.signatureType) || 'Unknown',
  signerSubject: normalizeText(artifact.signature?.signerSubject) || null,
  signerThumbprint: normalizeText(artifact.signature?.signerThumbprint) || null,
  timeStamperSubject: normalizeText(artifact.signature?.timeStamperSubject) || null,
  timeStamperThumbprint: normalizeText(artifact.signature?.timeStamperThumbprint) || null,
});

export const evaluateWindowsSigningEvidence = ({ artifacts = [], smartScreenEvidence = null } = {}) => {
  const checks = [];
  const blockers = [];
  let signedArtifactCount = 0;
  let timestampedArtifactCount = 0;

  for (const artifact of artifacts) {
    const artifactId = normalizeText(artifact?.id) || 'unknown';
    const rulePrefix = `windows-code-signing-${artifactId}`;

    if (!requiredArtifactIds.has(artifactId)) {
      blockers.push(toBlocker(`${rulePrefix}-unexpected`, `Unexpected signing artifact "${artifactId}".`, artifactId));
      continue;
    }

    if (artifact.exists !== true) {
      blockers.push(toBlocker(`${rulePrefix}-missing`, `Windows signing artifact "${artifactId}" is missing.`, artifactId));
      continue;
    }

    checks.push(`${rulePrefix}-exists`);

    const validSignature = hasValidSignature(artifact.signature);
    if (validSignature) {
      signedArtifactCount += 1;
      checks.push(`${rulePrefix}-valid`);
    } else {
      blockers.push(
        toBlocker(`${rulePrefix}-not-valid`, `Windows signing artifact "${artifactId}" is not validly signed.`, artifactId),
      );
    }

    if (hasTimestamp(artifact.signature)) {
      timestampedArtifactCount += 1;
      checks.push(`${rulePrefix}-timestamped`);
    } else {
      blockers.push(
        toBlocker(
          `${rulePrefix}-timestamp-missing`,
          `Windows signing artifact "${artifactId}" does not include timestamp evidence.`,
          artifactId,
        ),
      );
    }
  }

  for (const requiredArtifactId of requiredArtifactIds) {
    if (!artifacts.some((artifact) => artifact?.id === requiredArtifactId)) {
      blockers.push(
        toBlocker(
          `windows-code-signing-${requiredArtifactId}-missing`,
          `Windows signing artifact "${requiredArtifactId}" was not provided.`,
          requiredArtifactId,
        ),
      );
    }
  }

  const codeSigningOk = blockers.every((blocker) => !blocker.ruleId.startsWith('windows-code-signing-'));
  if (codeSigningOk) checks.push('windows-code-signing-all-valid');

  const smartScreenStatus = normalizeText(smartScreenEvidence?.status).toLowerCase();
  let smartScreenOk = false;

  if (!codeSigningOk) {
    blockers.push(
      toBlocker(
        'windows-smartscreen-blocked-unsigned',
        'SmartScreen reputation cannot be accepted until every Windows artifact is signed and timestamped.',
      ),
    );
  } else if (!smartScreenEvidence) {
    blockers.push(
      toBlocker(
        'windows-smartscreen-evidence-missing',
        'SmartScreen reputation evidence was not supplied for the signed Windows artifacts.',
      ),
    );
  } else if (smartScreenStatus !== 'passed') {
    if (internalSmartScreenStatuses.has(smartScreenStatus)) {
      smartScreenOk = true;
      checks.push('windows-smartscreen-internal-scope-accepted');
    } else {
      blockers.push(
        toBlocker(
          'windows-smartscreen-evidence-not-passed',
          'SmartScreen evidence must have status "passed" for public release or "internal-not-required" for internal-only distribution.',
        ),
      );
    }
  } else {
    smartScreenOk = true;
    checks.push('windows-smartscreen-evidence-passed');
  }

  return {
    ok: codeSigningOk && smartScreenOk,
    mutatesSystem: false,
    checks,
    blockers,
    artifacts,
    codeSigning: {
      ok: codeSigningOk,
      requiredArtifactIds: [...requiredArtifactIds],
      artifactCount: artifacts.length,
      signedArtifactCount,
      timestampedArtifactCount,
    },
    smartScreen: {
      ok: smartScreenOk,
      status: smartScreenEvidence ? smartScreenStatus || 'unknown' : 'missing',
      checkedAt: smartScreenEvidence?.checkedAt || null,
      environment: smartScreenEvidence?.environment || null,
    },
  };
};

export const buildWindowsSigningEvidenceArtifactPayload = (result) => ({
  ok: result.ok,
  mutatesSystem: false,
  checks: result.checks,
  blockers: result.blockers,
  codeSigning: result.codeSigning,
  smartScreen: result.smartScreen,
  artifacts: result.artifacts.map(sanitizeArtifactForPayload),
});
