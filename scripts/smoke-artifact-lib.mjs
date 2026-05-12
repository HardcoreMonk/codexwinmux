import fs from 'fs/promises';
import path from 'path';
import { readEnvAlias } from './env-alias-lib.mjs';

const droppedKeyPattern = /^(homeDir|serverOutput|output|outputTail|logcat|cookie|token|password|sessionCookie|raw|stdout|stderr|sessionName|sessionId|workspaceId|tabId|jsonlPath|baseUrl|targetUrl|pageUrl|restoreUrl|devtools|adb|serial|serverPort|remoteDebuggingPort)$/i;
const jsonlPathPattern = /(?:[A-Za-z]:)?[^"'\n\r\t ]*\.codex[\/\\]sessions[\/\\][^"'\n\r\t ]+/g;
const tempPathPattern = /(?:[A-Za-z]:)?[\/\\]tmp[\/\\]codexmux-[^"'\n\r\t ]+/g;
const windowsTempPathPattern = /(?:[A-Za-z]:)?[^"'\n\r\t ]*[\/\\]temp[\/\\]codexmux-[^"'\n\r\t ]+/gi;
const smokeSecretPattern = /secret-(android|electron|browser|runtime|timeline|reconnect)-[a-z0-9-]+/gi;

const timestampForFilename = (value) =>
  new Date(value).toISOString().replace(/[-:]/g, '').replace('.', '').replace('Z', 'Z');

export const buildSmokeArtifactFilename = ({ smokeName, status, endedAt = new Date().toISOString() }) =>
  `${smokeName}-${timestampForFilename(endedAt)}-${status}.json`;

const sanitizeString = (value) =>
  value
    .replace(windowsTempPathPattern, '[tmp]')
    .replace(tempPathPattern, '[tmp]')
    .replace(jsonlPathPattern, '[codex-session-path]')
    .replace(smokeSecretPattern, '[content]');

export const sanitizeSmokeArtifactPayload = (value) => {
  if (Array.isArray(value)) return value.map((item) => sanitizeSmokeArtifactPayload(item));
  if (!value || typeof value !== 'object') {
    return typeof value === 'string' ? sanitizeString(value) : value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !droppedKeyPattern.test(key))
      .map(([key, item]) => [key, sanitizeSmokeArtifactPayload(item)]),
  );
};

export const writeSmokeArtifact = async ({
  smokeName,
  status,
  payload,
  startedAt,
  endedAt = new Date().toISOString(),
  env = process.env,
}) => {
  const artifactDir = readEnvAlias(env, 'CODEXMUX_SMOKE_ARTIFACT_DIR');
  if (!artifactDir) return { skipped: true, path: null };

  const startMs = Date.parse(startedAt);
  const endMs = Date.parse(endedAt);
  const artifact = {
    schemaVersion: 1,
    smokeName,
    status,
    startedAt,
    endedAt,
    durationMs: Number.isFinite(startMs) && Number.isFinite(endMs) ? Math.max(0, endMs - startMs) : null,
    payload: sanitizeSmokeArtifactPayload(payload),
  };

  await fs.mkdir(artifactDir, { recursive: true });
  const artifactPath = path.join(artifactDir, buildSmokeArtifactFilename({ smokeName, status, endedAt }));
  await fs.writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf-8');
  return { skipped: false, path: artifactPath };
};
