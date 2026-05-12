import { describe, expect, it } from 'vitest';
import path from 'path';
import { pathToFileURL } from 'url';

const loadLib = async () =>
  import(pathToFileURL(path.join(process.cwd(), 'scripts/codexwinmux-strict-identity-lib.mjs')).href);

describe('codexwinmux strict identity helpers', () => {
  it('accepts preferred product, repository, installer, and env alias identity', async () => {
    const { evaluateCodexwinmuxStrictIdentity } = await loadLib();

    const result = evaluateCodexwinmuxStrictIdentity({
      packageJson: {
        name: 'codexwinmux',
        repository: { url: 'https://github.com/HardcoreMonk/codexwinmux.git' },
        homepage: 'https://github.com/HardcoreMonk/codexwinmux',
        bugs: { url: 'https://github.com/HardcoreMonk/codexwinmux/issues' },
        bin: {
          codexwinmux: './bin/codexmux.js',
          cwmux: './bin/codexmux.js',
          codexmux: './bin/codexmux.js',
        },
      },
      builderConfig: {
        appId: 'com.hardcoremonk.codexwinmux',
        productName: 'codexwinmux',
        nsis: { artifactName: '${productName}-Setup-${version}.${ext}' },
        publish: { repo: 'codexwinmux' },
      },
      env: {
        CODEXWINMUX_STRICT_IDENTITY: '1',
        CODEXWINMUX_SMOKE_ARTIFACT_DIR: 'C:\\tmp\\strict-identity',
        CODEXWINMUX_SMARTSCREEN_STATUS: 'internal-not-required',
        CODEXWINMUX_WINDOWS_RELEASE_DIR: 'D:\\release',
      },
    });

    expect(result.ok).toBe(true);
    expect(result.blockers).toEqual([]);
    expect(result.checks).toEqual(expect.arrayContaining([
      'strict-identity-package-name-codexwinmux',
      'strict-identity-preferred-cli-aliases-present',
      'strict-identity-builder-product-codexwinmux',
      'strict-identity-preferred-env-aliases-present',
    ]));
  });

  it('blocks old external env keys when strict identity is enabled', async () => {
    const { evaluateCodexwinmuxStrictIdentity } = await loadLib();

    const result = evaluateCodexwinmuxStrictIdentity({
      packageJson: {
        name: 'codexwinmux',
        repository: { url: 'https://github.com/HardcoreMonk/codexwinmux.git' },
        homepage: 'https://github.com/HardcoreMonk/codexwinmux',
        bugs: { url: 'https://github.com/HardcoreMonk/codexwinmux/issues' },
        bin: { codexwinmux: './bin/codexmux.js', cwmux: './bin/codexmux.js' },
      },
      builderConfig: {
        appId: 'com.hardcoremonk.codexwinmux',
        productName: 'codexwinmux',
        nsis: { artifactName: '${productName}-Setup-${version}.${ext}' },
        publish: { repo: 'codexwinmux' },
      },
      env: {
        CODEXWINMUX_STRICT_IDENTITY: '1',
        CODEXMUX_SMOKE_ARTIFACT_DIR: 'C:\\tmp\\legacy',
      },
    });

    expect(result.ok).toBe(false);
    expect(result.blockers.map((blocker: { ruleId: string }) => blocker.ruleId)).toContain(
      'strict-identity-legacy-env-present',
    );
  });

  it('blocks legacy CLI aliases when legacy sunset mode is enabled', async () => {
    const { evaluateCodexwinmuxStrictIdentity } = await loadLib();

    const result = evaluateCodexwinmuxStrictIdentity({
      packageJson: {
        name: 'codexwinmux',
        repository: { url: 'https://github.com/HardcoreMonk/codexwinmux.git' },
        homepage: 'https://github.com/HardcoreMonk/codexwinmux',
        bugs: { url: 'https://github.com/HardcoreMonk/codexwinmux/issues' },
        bin: {
          codexwinmux: './bin/codexmux.js',
          cwmux: './bin/codexmux.js',
          codexmux: './bin/codexmux.js',
          cmux: './bin/codexmux.js',
        },
      },
      builderConfig: {
        appId: 'com.hardcoremonk.codexwinmux',
        productName: 'codexwinmux',
        nsis: { artifactName: '${productName}-Setup-${version}.${ext}' },
        publish: { repo: 'codexwinmux' },
      },
      env: {
        CODEXWINMUX_STRICT_IDENTITY: '1',
        CODEXWINMUX_LEGACY_SUNSET: '1',
      },
    });

    expect(result.ok).toBe(false);
    expect(result.blockers.map((blocker: { ruleId: string }) => blocker.ruleId)).toContain(
      'strict-identity-legacy-cli-alias-present',
    );
  });

  it('accepts legacy sunset mode when only preferred CLI aliases remain', async () => {
    const { evaluateCodexwinmuxStrictIdentity } = await loadLib();

    const result = evaluateCodexwinmuxStrictIdentity({
      packageJson: {
        name: 'codexwinmux',
        repository: { url: 'https://github.com/HardcoreMonk/codexwinmux.git' },
        homepage: 'https://github.com/HardcoreMonk/codexwinmux',
        bugs: { url: 'https://github.com/HardcoreMonk/codexwinmux/issues' },
        bin: {
          codexwinmux: './bin/codexmux.js',
          cwmux: './bin/codexmux.js',
        },
      },
      builderConfig: {
        appId: 'com.hardcoremonk.codexwinmux',
        productName: 'codexwinmux',
        nsis: { artifactName: '${productName}-Setup-${version}.${ext}' },
        publish: { repo: 'codexwinmux' },
      },
      env: {
        CODEXWINMUX_STRICT_IDENTITY: '1',
        CODEXWINMUX_LEGACY_SUNSET: '1',
      },
    });

    expect(result.ok).toBe(true);
    expect(result.checks).toContain('strict-identity-legacy-cli-aliases-removed');
  });
});
