import path from 'path';
import { pathToFileURL } from 'url';
import { describe, expect, it } from 'vitest';

const loadLib = async () =>
  import(pathToFileURL(path.join(process.cwd(), 'scripts/release-immutability-lib.mjs')).href);

describe('release immutability helpers', () => {
  it('allows publishing only when the version tag and release do not exist yet', async () => {
    const { evaluateReleaseImmutability } = await loadLib();

    expect(evaluateReleaseImmutability({
      packageVersion: '0.4.15',
      localTagCommit: null,
      remoteTagCommit: null,
      githubReleaseUrl: null,
    })).toMatchObject({
      ok: true,
      tag: 'v0.4.15',
      blockers: [],
    });
  });

  it('blocks republishing an existing version even when the remote tag points at the current commit', async () => {
    const { evaluateReleaseImmutability } = await loadLib();

    const result = evaluateReleaseImmutability({
      packageVersion: '0.4.14',
      localTagCommit: '591d9ce1',
      remoteTagCommit: '591d9ce1',
      githubReleaseUrl: 'https://github.com/HardcoreMonk/codexwinmux/releases/tag/v0.4.14',
    });

    expect(result.ok).toBe(false);
    expect(result.blockers.map((blocker: { ruleId: string }) => blocker.ruleId)).toEqual([
      'release-immutability-version-below-minimum',
      'release-immutability-local-tag-exists',
      'release-immutability-remote-tag-exists',
      'release-immutability-github-release-exists',
    ]);
  });
});
