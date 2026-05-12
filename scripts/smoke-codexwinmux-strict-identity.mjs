#!/usr/bin/env node
import fsp from 'fs/promises';
import path from 'path';
import yaml from 'js-yaml';
import { evaluateCodexwinmuxStrictIdentity } from './codexwinmux-strict-identity-lib.mjs';
import { writeSmokeArtifact } from './smoke-artifact-lib.mjs';

const SMOKE_NAME = 'codexwinmux-strict-identity';
const startedAt = new Date().toISOString();
const rootDir = process.cwd();

const readJson = async (filePath) => JSON.parse(await fsp.readFile(filePath, 'utf8'));

const writeArtifact = async (status, payload) =>
  writeSmokeArtifact({
    smokeName: SMOKE_NAME,
    status,
    startedAt,
    payload,
  }).catch((err) => {
    console.error(JSON.stringify({
      ok: false,
      code: 'strict-identity-artifact-write-failed',
      message: err instanceof Error ? err.message : String(err),
    }, null, 2));
  });

const main = async () => {
  const packageJson = await readJson(path.join(rootDir, 'package.json'));
  const builderConfig = yaml.load(await fsp.readFile(path.join(rootDir, 'electron-builder.yml'), 'utf8'));
  const result = evaluateCodexwinmuxStrictIdentity({
    packageJson,
    builderConfig,
    env: process.env,
  });

  await writeArtifact(result.ok ? 'passed' : 'failed', result);
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(1);
};

main().catch(async (err) => {
  const payload = {
    ok: false,
    mutatesSystem: false,
    code: 'strict-identity-smoke-failed',
    message: err instanceof Error ? err.message : String(err),
  };
  await writeArtifact('failed', payload);
  console.error(JSON.stringify(payload, null, 2));
  process.exit(1);
});
