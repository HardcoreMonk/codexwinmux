import path from 'path';
import { pathToFileURL } from 'url';
import { describe, expect, it } from 'vitest';

const loadLib = async () =>
  import(pathToFileURL(path.join(process.cwd(), 'scripts/windows-smartscreen-public-evidence-lib.mjs')).href);

describe('Windows SmartScreen public evidence helpers', () => {
  it('builds public launch evidence with the fields required by signing evidence', async () => {
    const { buildWindowsSmartScreenPublicEvidence } = await loadLib();

    const evidence = buildWindowsSmartScreenPublicEvidence({
      artifactSha256: 'ABC123',
      checkedAt: '2026-05-12T00:00:00.000Z',
      downloadUrl: 'https://github.com/HardcoreMonk/codexwinmux/releases/download/v0.4.14/codexwinmux-Setup-0.4.14.exe',
      environment: 'clean-windows-11-vm',
      launch: {
        exitCode: 0,
        started: true,
        timedOut: false,
      },
      zoneId: 3,
    });

    expect(evidence).toEqual({
      status: 'passed',
      checkedAt: '2026-05-12T00:00:00.000Z',
      environment: 'clean-windows-11-vm',
      verificationMethod: 'windows-smartscreen-public-launch-smoke',
      artifactSha256: 'ABC123',
      download: {
        url: 'https://github.com/HardcoreMonk/codexwinmux/releases/download/v0.4.14/codexwinmux-Setup-0.4.14.exe',
        zoneId: 3,
      },
      launch: {
        started: true,
        exitCode: 0,
        timedOut: false,
      },
    });
  });

  it('rejects launch evidence when the download did not keep Internet ZoneId', async () => {
    const { hasWindowsSmartScreenPublicLaunchEvidence } = await loadLib();

    expect(hasWindowsSmartScreenPublicLaunchEvidence({
      status: 'passed',
      verificationMethod: 'windows-smartscreen-public-launch-smoke',
      download: {
        url: 'https://example.test/codexwinmux.exe',
        zoneId: 0,
      },
      launch: {
        started: true,
        exitCode: 0,
        timedOut: false,
      },
    })).toBe(false);
  });
});
