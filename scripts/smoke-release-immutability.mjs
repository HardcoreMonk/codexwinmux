#!/usr/bin/env node
import { execFileSync, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { writeSmokeArtifact } from './smoke-artifact-lib.mjs';
import {
  buildReleaseImmutabilityArtifactPayload,
  buildReleaseTag,
  evaluateReleaseImmutability,
} from './release-immutability-lib.mjs';

const rootDir = process.cwd();
const startedAt = new Date().toISOString();

const runGit = (args) => {
  try {
    return execFileSync('git', args, {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
};

const readGithubReleaseUrl = (tag) => {
  const result = spawnSync('gh', ['release', 'view', tag, '--json', 'url'], {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    windowsHide: true,
  });
  if (result.status !== 0 || !result.stdout.trim()) return null;
  try {
    return JSON.parse(result.stdout).url ?? null;
  } catch {
    return null;
  }
};

const main = async () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  const tag = buildReleaseTag(packageJson.version);
  const localTagCommit = runGit(['rev-parse', '-q', '--verify', `refs/tags/${tag}`]);
  const remoteTagOutput = runGit(['ls-remote', '--tags', 'origin', tag]);
  const remoteTagCommit = remoteTagOutput?.split(/\s+/)[0] ?? null;
  const githubReleaseUrl = readGithubReleaseUrl(tag);
  const result = evaluateReleaseImmutability({
    packageVersion: packageJson.version,
    localTagCommit,
    remoteTagCommit,
    githubReleaseUrl,
  });
  const payload = buildReleaseImmutabilityArtifactPayload(result);

  await writeSmokeArtifact({
    smokeName: 'release-immutability',
    status: result.ok ? 'passed' : 'failed',
    startedAt,
    payload,
  }).catch(() => null);

  console.log(JSON.stringify(payload, null, 2));
  if (!result.ok) process.exit(1);
};

main().catch((err) => {
  console.error(JSON.stringify({
    ok: false,
    code: 'release-immutability-smoke-failed',
    message: err instanceof Error ? err.message : String(err),
  }, null, 2));
  process.exit(1);
});
