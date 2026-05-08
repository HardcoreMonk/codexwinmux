#!/usr/bin/env node
import crypto from 'crypto';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { spawnSync } from 'child_process';
import yaml from 'js-yaml';
import { writeSmokeArtifact } from './smoke-artifact-lib.mjs';
import {
  buildWindowsSigningEvidenceArtifactPayload,
  evaluateWindowsSigningEvidence,
} from './windows-signing-evidence-lib.mjs';

const SMOKE_NAME = 'windows-signing-evidence';
const rootDir = process.cwd();
const startedAt = new Date().toISOString();

const psQuote = (value) => `'${String(value).replace(/'/g, "''")}'`;

const readJsonFile = async (filePath) => JSON.parse(await fsp.readFile(filePath, 'utf8'));

const runPowerShell = (command) => {
  const candidates = [
    process.env.CODEXMUX_POWERSHELL_PATH,
    'pwsh.exe',
    'powershell.exe',
  ].filter(Boolean);
  const seen = new Set();
  let lastOutput = null;

  for (const candidate of candidates) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);

    const output = spawnSync(candidate, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], {
      encoding: 'utf8',
      windowsHide: true,
    });
    lastOutput = output;
    if (output.status === 0 && output.stdout.trim()) return output;
  }

  return lastOutput;
};

const sha256File = (filePath) =>
  new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex').toUpperCase()));
  });

const collectAuthenticodeSignature = (filePath) => {
  if (process.platform !== 'win32') {
    return {
      status: 'Unavailable',
      statusMessage: 'Get-AuthenticodeSignature requires Windows.',
      signatureType: 'Unknown',
      signerSubject: null,
      signerThumbprint: null,
      timeStamperSubject: null,
      timeStamperThumbprint: null,
    };
  }

  const command = `
$ErrorActionPreference = 'Stop'
$signature = Get-AuthenticodeSignature -LiteralPath ${psQuote(filePath)}
$signer = $signature.SignerCertificate
$timeStamper = $signature.TimeStamperCertificate
[PSCustomObject]@{
  status = [string]$signature.Status
  statusMessage = [string]$signature.StatusMessage
  signatureType = [string]$signature.SignatureType
  signerSubject = if ($signer) { [string]$signer.Subject } else { $null }
  signerIssuer = if ($signer) { [string]$signer.Issuer } else { $null }
  signerThumbprint = if ($signer) { [string]$signer.Thumbprint } else { $null }
  signerNotBefore = if ($signer) { $signer.NotBefore.ToUniversalTime().ToString("o") } else { $null }
  signerNotAfter = if ($signer) { $signer.NotAfter.ToUniversalTime().ToString("o") } else { $null }
  timeStamperSubject = if ($timeStamper) { [string]$timeStamper.Subject } else { $null }
  timeStamperThumbprint = if ($timeStamper) { [string]$timeStamper.Thumbprint } else { $null }
} | ConvertTo-Json -Compress
`;

  const output = runPowerShell(command);

  if (!output || output.status !== 0) {
    return {
      status: 'Unavailable',
      statusMessage: (output?.stderr || output?.stdout || 'Get-AuthenticodeSignature failed.').trim(),
      signatureType: 'Unknown',
      signerSubject: null,
      signerThumbprint: null,
      timeStamperSubject: null,
      timeStamperThumbprint: null,
    };
  }

  return JSON.parse(output.stdout);
};

const collectArtifact = async ({ id, filePath }) => {
  const stat = await fsp.stat(filePath).catch(() => null);
  const exists = Boolean(stat?.isFile());

  return {
    id,
    fileName: path.basename(filePath),
    path: filePath,
    exists,
    sizeBytes: exists ? stat.size : null,
    sha256: exists ? await sha256File(filePath) : null,
    signature: exists
      ? collectAuthenticodeSignature(filePath)
      : {
          status: 'Missing',
          statusMessage: 'Artifact file was not found.',
          signatureType: 'Unknown',
          signerSubject: null,
          signerThumbprint: null,
          timeStamperSubject: null,
          timeStamperThumbprint: null,
        },
  };
};

const readSmartScreenEvidence = async () => {
  if (process.env.CODEXMUX_SMARTSCREEN_EVIDENCE_PATH) {
    return readJsonFile(path.resolve(process.env.CODEXMUX_SMARTSCREEN_EVIDENCE_PATH));
  }

  if (process.env.CODEXMUX_SMARTSCREEN_STATUS) {
    return {
      status: process.env.CODEXMUX_SMARTSCREEN_STATUS,
      checkedAt: process.env.CODEXMUX_SMARTSCREEN_CHECKED_AT || new Date().toISOString(),
      environment: process.env.CODEXMUX_SMARTSCREEN_ENVIRONMENT || 'manual',
    };
  }

  return null;
};

const resolveArtifactPaths = async () => {
  const packageJson = await readJsonFile(path.join(rootDir, 'package.json'));
  const builderConfigPath = path.join(rootDir, 'electron-builder.yml');
  const builderConfig = fs.existsSync(builderConfigPath)
    ? yaml.load(await fsp.readFile(builderConfigPath, 'utf8'))
    : {};
  const releaseDir = path.resolve(process.env.CODEXMUX_WINDOWS_RELEASE_DIR || builderConfig?.directories?.output || 'release');
  const productName = builderConfig?.productName || packageJson.name;

  return {
    installer:
      process.env.CODEXMUX_WINDOWS_SIGNING_INSTALLER_PATH ||
      path.join(releaseDir, `${productName}-Setup-${packageJson.version}.exe`),
    unpackedExe:
      process.env.CODEXMUX_WINDOWS_SIGNING_UNPACKED_EXE_PATH ||
      path.join(releaseDir, 'win-unpacked', `${productName}.exe`),
  };
};

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

const main = async () => {
  const artifactPaths = await resolveArtifactPaths();
  const artifacts = await Promise.all([
    collectArtifact({ id: 'installer', filePath: path.resolve(artifactPaths.installer) }),
    collectArtifact({ id: 'unpacked-exe', filePath: path.resolve(artifactPaths.unpackedExe) }),
  ]);
  const smartScreenEvidence = await readSmartScreenEvidence();
  const result = evaluateWindowsSigningEvidence({ artifacts, smartScreenEvidence });
  const payload = buildWindowsSigningEvidenceArtifactPayload(result);

  await writeArtifact(result.ok ? 'passed' : 'failed', payload);
  console.log(JSON.stringify(payload, null, 2));
  if (!result.ok) process.exit(1);
};

main().catch(async (err) => {
  const payload = {
    ok: false,
    mutatesSystem: false,
    code: 'windows-signing-evidence-smoke-failed',
    message: err instanceof Error ? err.message : String(err),
  };
  await writeArtifact('failed', payload);
  console.error(JSON.stringify(payload, null, 2));
  process.exit(1);
});
