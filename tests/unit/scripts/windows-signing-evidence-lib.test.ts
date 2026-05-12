import path from 'path';
import { pathToFileURL } from 'url';
import { describe, expect, it } from 'vitest';

const loadLib = async () =>
  import(pathToFileURL(path.join(process.cwd(), 'scripts/windows-signing-evidence-lib.mjs')).href);

const unsignedArtifacts = [
  {
    id: 'installer',
    fileName: 'codexwinmux-Setup-0.4.13.exe',
    path: 'D:/sensitive/release/codexwinmux-Setup-0.4.13.exe',
    exists: true,
    sha256: 'abc123',
    signature: {
      status: 'NotSigned',
      statusMessage: 'not digitally signed',
      signatureType: 'None',
      signerSubject: null,
      signerThumbprint: null,
      timeStamperSubject: null,
      timeStamperThumbprint: null,
    },
  },
  {
    id: 'unpacked-exe',
    fileName: 'codexwinmux.exe',
    path: 'D:/sensitive/release/win-unpacked/codexwinmux.exe',
    exists: true,
    sha256: 'def456',
    signature: {
      status: 'NotSigned',
      statusMessage: 'not digitally signed',
      signatureType: 'None',
      signerSubject: null,
      signerThumbprint: null,
      timeStamperSubject: null,
      timeStamperThumbprint: null,
    },
  },
];

describe('Windows signing evidence helpers', () => {
  it('blocks unsigned artifacts and keeps local paths out of artifact payloads', async () => {
    const {
      buildWindowsSigningEvidenceArtifactPayload,
      evaluateWindowsSigningEvidence,
    } = await loadLib();

    const result = evaluateWindowsSigningEvidence({
      artifacts: unsignedArtifacts,
      smartScreenEvidence: null,
    });
    const payload = buildWindowsSigningEvidenceArtifactPayload(result);

    expect(result.ok).toBe(false);
    expect(result.codeSigning.ok).toBe(false);
    expect(result.smartScreen.ok).toBe(false);
    expect(result.blockers.map((blocker: { ruleId: string }) => blocker.ruleId)).toEqual([
      'windows-code-signing-installer-not-valid',
      'windows-code-signing-installer-timestamp-missing',
      'windows-code-signing-unpacked-exe-not-valid',
      'windows-code-signing-unpacked-exe-timestamp-missing',
      'windows-smartscreen-blocked-unsigned',
    ]);
    expect(JSON.stringify(payload)).not.toContain('D:/sensitive');
    expect(payload.artifacts[0]).toMatchObject({
      id: 'installer',
      fileName: 'codexwinmux-Setup-0.4.13.exe',
      signatureStatus: 'NotSigned',
      sha256: 'abc123',
    });
  });

  it('accepts signed and timestamped artifacts when SmartScreen evidence is passed', async () => {
    const { evaluateWindowsSigningEvidence } = await loadLib();
    const signedArtifacts = unsignedArtifacts.map((artifact) => ({
      ...artifact,
      signature: {
        status: 'Valid',
        statusMessage: 'Signature verified',
        signatureType: 'Authenticode',
        signerSubject: 'CN=HardcoreMonk Internal',
        signerThumbprint: 'ABCDEF',
        timeStamperSubject: 'CN=Timestamp Authority',
        timeStamperThumbprint: '123456',
      },
    }));

    const result = evaluateWindowsSigningEvidence({
      artifacts: signedArtifacts,
      smartScreenEvidence: {
        status: 'passed',
        checkedAt: '2026-05-08T13:20:00.000Z',
        environment: 'clean-windows-11-vm',
      },
    });

    expect(result.ok).toBe(true);
    expect(result.checks).toContain('windows-code-signing-all-valid');
    expect(result.checks).toContain('windows-smartscreen-evidence-passed');
    expect(result.blockers).toEqual([]);
  });

  it('keeps SmartScreen blocked until explicit passed evidence is supplied', async () => {
    const { evaluateWindowsSigningEvidence } = await loadLib();
    const signedArtifacts = unsignedArtifacts.map((artifact) => ({
      ...artifact,
      signature: {
        status: 'Valid',
        statusMessage: 'Signature verified',
        signatureType: 'Authenticode',
        signerSubject: 'CN=HardcoreMonk Internal',
        signerThumbprint: 'ABCDEF',
        timeStamperSubject: 'CN=Timestamp Authority',
        timeStamperThumbprint: '123456',
      },
    }));

    const result = evaluateWindowsSigningEvidence({
      artifacts: signedArtifacts,
      smartScreenEvidence: {
        status: 'warning',
        checkedAt: '2026-05-08T13:20:00.000Z',
        environment: 'clean-windows-11-vm',
      },
    });

    expect(result.ok).toBe(false);
    expect(result.codeSigning.ok).toBe(true);
    expect(result.smartScreen.ok).toBe(false);
    expect(result.blockers.map((blocker: { ruleId: string }) => blocker.ruleId)).toEqual([
      'windows-smartscreen-evidence-not-passed',
    ]);
  });

  it('accepts internal-only SmartScreen evidence when artifacts are signed and timestamped', async () => {
    const { evaluateWindowsSigningEvidence } = await loadLib();
    const signedArtifacts = unsignedArtifacts.map((artifact) => ({
      ...artifact,
      signature: {
        status: 'Valid',
        statusMessage: 'Signature verified',
        signatureType: 'Authenticode',
        signerSubject: 'CN=PureCVisor Desktop Node Internal Code Signing',
        signerThumbprint: 'ABCDEF',
        timeStamperSubject: 'CN=Timestamp Authority',
        timeStamperThumbprint: '123456',
      },
    }));

    const result = evaluateWindowsSigningEvidence({
      artifacts: signedArtifacts,
      smartScreenEvidence: {
        status: 'internal-not-required',
        checkedAt: '2026-05-12T00:00:00.000Z',
        environment: 'internal-trusted-root-distribution',
      },
    });

    expect(result.ok).toBe(true);
    expect(result.smartScreen).toMatchObject({
      ok: true,
      status: 'internal-not-required',
      environment: 'internal-trusted-root-distribution',
    });
    expect(result.checks).toContain('windows-smartscreen-internal-scope-accepted');
    expect(result.blockers).toEqual([]);
  });

  it('blocks internal-only SmartScreen evidence for public release mode', async () => {
    const { evaluateWindowsSigningEvidence } = await loadLib();
    const signedArtifacts = unsignedArtifacts.map((artifact) => ({
      ...artifact,
      signature: {
        status: 'Valid',
        statusMessage: 'Signature verified',
        signatureType: 'Authenticode',
        signerSubject: 'CN=PureCVisor Desktop Node Internal Code Signing',
        signerThumbprint: 'ABCDEF',
        timeStamperSubject: 'CN=Timestamp Authority',
        timeStamperThumbprint: '123456',
      },
    }));

    const result = evaluateWindowsSigningEvidence({
      artifacts: signedArtifacts,
      publicRelease: true,
      smartScreenEvidence: {
        status: 'internal-not-required',
        checkedAt: '2026-05-12T00:00:00.000Z',
        environment: 'internal-trusted-root-distribution',
      },
    });

    expect(result.ok).toBe(false);
    expect(result.codeSigning.ok).toBe(true);
    expect(result.smartScreen).toMatchObject({
      ok: false,
      status: 'internal-not-required',
      publicRelease: true,
    });
    expect(result.blockers.map((blocker: { ruleId: string }) => blocker.ruleId)).toEqual([
      'windows-smartscreen-public-evidence-required',
    ]);
  });

  it('blocks bare passed SmartScreen status in public release mode without public launch evidence', async () => {
    const { evaluateWindowsSigningEvidence } = await loadLib();
    const signedArtifacts = unsignedArtifacts.map((artifact) => ({
      ...artifact,
      signature: {
        status: 'Valid',
        statusMessage: 'Signature verified',
        signatureType: 'Authenticode',
        signerSubject: 'CN=PureCVisor Desktop Node Internal Code Signing',
        signerThumbprint: 'ABCDEF',
        timeStamperSubject: 'CN=Timestamp Authority',
        timeStamperThumbprint: '123456',
      },
    }));

    const result = evaluateWindowsSigningEvidence({
      artifacts: signedArtifacts,
      publicRelease: true,
      smartScreenEvidence: {
        status: 'passed',
        checkedAt: '2026-05-12T00:00:00.000Z',
        environment: 'clean-windows-11-vm',
      },
    });

    expect(result.ok).toBe(false);
    expect(result.blockers.map((blocker: { ruleId: string }) => blocker.ruleId)).toEqual([
      'windows-smartscreen-public-launch-evidence-required',
    ]);
  });

  it('accepts public SmartScreen passed evidence from a public launch smoke', async () => {
    const { evaluateWindowsSigningEvidence } = await loadLib();
    const signedArtifacts = unsignedArtifacts.map((artifact) => ({
      ...artifact,
      signature: {
        status: 'Valid',
        statusMessage: 'Signature verified',
        signatureType: 'Authenticode',
        signerSubject: 'CN=PureCVisor Desktop Node Internal Code Signing',
        signerThumbprint: 'ABCDEF',
        timeStamperSubject: 'CN=Timestamp Authority',
        timeStamperThumbprint: '123456',
      },
    }));

    const result = evaluateWindowsSigningEvidence({
      artifacts: signedArtifacts,
      publicRelease: true,
      smartScreenEvidence: {
        status: 'passed',
        checkedAt: '2026-05-12T00:00:00.000Z',
        environment: 'clean-windows-11-vm',
        verificationMethod: 'windows-smartscreen-public-launch-smoke',
        artifactSha256: 'D9C41DEAF282B7EF6C681392D6B30E43602F5E3C18F389F84BFF383AA7F4F995',
        download: {
          url: 'https://github.com/HardcoreMonk/codexwinmux/releases/download/v0.4.14/codexwinmux-Setup-0.4.14.exe',
          zoneId: 3,
        },
        launch: {
          started: true,
          exitCode: 0,
          timedOut: false,
        },
      },
    });

    expect(result.ok).toBe(true);
    expect(result.checks).toContain('windows-smartscreen-public-evidence-passed');
    expect(result.checks).toContain('windows-smartscreen-public-launch-evidence-present');
    expect(result.blockers).toEqual([]);
  });
});
