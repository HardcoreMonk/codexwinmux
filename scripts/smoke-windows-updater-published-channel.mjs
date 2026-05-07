#!/usr/bin/env node
import fs from 'fs/promises';
import https from 'https';
import path from 'path';
import yaml from 'js-yaml';
import { writeSmokeArtifact } from './smoke-artifact-lib.mjs';
import {
  buildWindowsPublishedUpdateArtifactPayload,
  evaluateWindowsPublishedUpdateChannel,
  resolveWindowsPublishedUpdateCurrentVersion,
  selectLatestPublishedRelease,
} from './windows-updater-published-channel-smoke-lib.mjs';

const rootDir = process.cwd();
const SMOKE_NAME = 'windows-updater-published-channel';
const startedAt = new Date().toISOString();

const writeArtifact = async (status, payload) =>
  writeSmokeArtifact({
    smokeName: SMOKE_NAME,
    status,
    startedAt,
    payload,
  }).catch((err) => {
    console.error(JSON.stringify({
      ok: false,
      code: 'smoke-artifact-write-failed',
      message: err instanceof Error ? err.message : String(err),
    }, null, 2));
  });

const fail = async (code, message, details = {}) => {
  const payload = { ok: false, code, message, mutatesSystem: false, ...details };
  await writeArtifact('failed', payload);
  console.error(JSON.stringify(payload, null, 2));
  process.exit(1);
};

const request = (url, { accept = 'application/vnd.github+json', redirectCount = 0 } = {}) =>
  new Promise((resolve, reject) => {
    const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
    const req = https.get(url, {
      headers: {
        Accept: accept,
        'User-Agent': 'codexmux-windows-updater-published-channel-smoke',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    }, (res) => {
      const statusCode = res.statusCode ?? 0;
      const location = res.headers.location;
      if ([301, 302, 303, 307, 308].includes(statusCode) && location && redirectCount < 5) {
        res.resume();
        resolve(request(new URL(location, url).toString(), { accept, redirectCount: redirectCount + 1 }));
        return;
      }

      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        if (statusCode < 200 || statusCode >= 300) {
          reject(new Error(`GET ${url} failed with HTTP ${statusCode}: ${body.slice(0, 300)}`));
          return;
        }
        resolve(body);
      });
    });
    req.once('error', reject);
    req.setTimeout(60_000, () => {
      req.destroy(new Error(`GET ${url} timed out`));
    });
  });

const readYamlIfExists = async (filePath) => {
  try {
    return yaml.load(await fs.readFile(filePath, 'utf8'));
  } catch (err) {
    if (err?.code === 'ENOENT') return null;
    throw err;
  }
};

const normalizePublishConfig = (publishConfig) => {
  if (Array.isArray(publishConfig)) return publishConfig[0] ?? null;
  return publishConfig && typeof publishConfig === 'object' ? publishConfig : null;
};

const buildReleasesApiUrl = ({ owner, repo }) =>
  `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases?per_page=10`;

const getAsset = (release, assetName) =>
  (Array.isArray(release?.assets) ? release.assets : [])
    .find((asset) => String(asset?.name || '').toLowerCase() === assetName.toLowerCase()) ?? null;

const main = async () => {
  try {
    const packageJson = JSON.parse(await fs.readFile(path.join(rootDir, 'package.json'), 'utf8'));
    const builderConfig = await readYamlIfExists(path.join(rootDir, 'electron-builder.yml'));
    const publishConfig = normalizePublishConfig(builderConfig?.publish);
    const owner = process.env.CODEXMUX_WINDOWS_UPDATER_PUBLISHED_OWNER || publishConfig?.owner;
    const repo = process.env.CODEXMUX_WINDOWS_UPDATER_PUBLISHED_REPO || publishConfig?.repo;

    if (!owner || !repo) {
      await fail(
        'windows-published-channel-config-missing',
        'electron-builder publish.owner/repo or CODEXMUX_WINDOWS_UPDATER_PUBLISHED_OWNER/REPO is required.',
      );
    }

    const releasesUrl = process.env.CODEXMUX_WINDOWS_UPDATER_PUBLISHED_RELEASES_URL
      || buildReleasesApiUrl({ owner, repo });
    const includePrerelease = process.env.CODEXMUX_WINDOWS_UPDATER_PUBLISHED_INCLUDE_PRERELEASE === '1';
    const releases = JSON.parse(await request(releasesUrl));
    const latestRelease = selectLatestPublishedRelease({ releases, includePrerelease });
    const latestYamlAsset = getAsset(latestRelease, 'latest.yml');
    const latestMetadata = latestYamlAsset?.browser_download_url
      ? yaml.load(await request(latestYamlAsset.browser_download_url, { accept: 'application/octet-stream' }))
      : null;
    const result = evaluateWindowsPublishedUpdateChannel({
      releases,
      currentVersion: resolveWindowsPublishedUpdateCurrentVersion({
        env: process.env,
        packageVersion: packageJson.version,
      }),
      latestMetadata,
      includePrerelease,
    });
    const payload = buildWindowsPublishedUpdateArtifactPayload(result);

    await writeArtifact(result.ok ? 'passed' : 'failed', payload);
    console.log(JSON.stringify(payload, null, 2));
    if (!result.ok) process.exit(1);
  } catch (err) {
    await fail(
      'windows-published-channel-smoke-failed',
      err instanceof Error ? err.message : String(err),
    );
  }
};

main();
