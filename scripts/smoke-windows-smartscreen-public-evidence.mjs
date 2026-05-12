#!/usr/bin/env node
import crypto from 'crypto';
import fs from 'fs';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { readEnvAlias } from './env-alias-lib.mjs';
import { writeSmokeArtifact } from './smoke-artifact-lib.mjs';
import {
  buildWindowsSmartScreenPublicEvidence,
  buildWindowsSmartScreenPublicEvidencePayload,
  hasWindowsSmartScreenPublicLaunchEvidence,
} from './windows-smartscreen-public-evidence-lib.mjs';

const SMOKE_NAME = 'windows-smartscreen-public-evidence';
const startedAt = new Date().toISOString();
const rootDir = process.cwd();
const psQuote = (value) => `'${String(value).replace(/'/g, "''")}'`;

const runPowerShell = (command, { timeoutMs = 300_000 } = {}) =>
  new Promise((resolve) => {
    const child = spawn(
      readEnvAlias(process.env, 'CODEXMUX_POWERSHELL_PATH') || 'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command],
      { cwd: rootDir, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.once('error', (err) => {
      clearTimeout(timer);
      resolve({ exitCode: 1, stdout, stderr: `${stderr}${err.message}`, timedOut });
    });
    child.once('close', (exitCode) => {
      clearTimeout(timer);
      resolve({ exitCode, stdout, stderr, timedOut });
    });
  });

const sha256File = (filePath) =>
  new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex').toUpperCase()));
  });

const parseZoneId = (zoneText) => {
  const text = Array.isArray(zoneText)
    ? zoneText.join('\n')
    : typeof zoneText === 'string'
      ? zoneText
      : JSON.stringify(zoneText ?? '');
  const match = /ZoneId\D+(\d+)/.exec(text);
  return match ? Number(match[1]) : null;
};

const downloadWithChromium = async ({ url, outputPath }) => {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.goto(url).catch((err) => {
        if (!String(err?.message || err).includes('Download is starting')) throw err;
      }),
    ]);
    const sourcePath = await download.path();
    const copyResult = await runPowerShell(`
$ErrorActionPreference = 'Stop'
Move-Item -LiteralPath ${psQuote(sourcePath)} -Destination ${psQuote(outputPath)} -Force
$zoneText = Get-Content -LiteralPath ${psQuote(outputPath)} -Stream Zone.Identifier -Raw -ErrorAction SilentlyContinue
[PSCustomObject]@{
  zoneText = $zoneText
} | ConvertTo-Json -Compress
`, { timeoutMs: 30_000 });
    if (copyResult.exitCode !== 0 || copyResult.timedOut) {
      throw new Error(`browser download copy failed: ${JSON.stringify({
        exitCode: copyResult.exitCode,
        timedOut: copyResult.timedOut,
        stderr: copyResult.stderr.slice(-1200),
      })}`);
    }
    const copyOutput = JSON.parse(copyResult.stdout || '{}');
    const zoneId = parseZoneId(copyOutput.zoneText);
    return {
      suggestedFilename: download.suggestedFilename(),
      zoneId,
    };
  } finally {
    await browser.close().catch(() => null);
  }
};

const writeArtifact = async (status, payload) =>
  writeSmokeArtifact({
    smokeName: SMOKE_NAME,
    status,
    startedAt,
    payload: buildWindowsSmartScreenPublicEvidencePayload(payload),
  }).catch(() => null);

const fail = async (ruleId, message, extra = {}) => {
  const payload = {
    ok: false,
    checks: [],
    blockers: [{ ruleId, message }],
    ...extra,
  };
  await writeArtifact('failed', payload);
  console.error(JSON.stringify(buildWindowsSmartScreenPublicEvidencePayload(payload), null, 2));
  process.exit(1);
};

const main = async () => {
  if (process.platform !== 'win32') {
    await fail('windows-smartscreen-public-platform-mismatch', 'Public SmartScreen launch evidence requires win32.', {
      platform: process.platform,
    });
  }

  const downloadUrl = readEnvAlias(process.env, 'CODEXMUX_SMARTSCREEN_DOWNLOAD_URL');
  if (!downloadUrl) {
    await fail(
      'windows-smartscreen-public-download-url-missing',
      'CODEXWINMUX_SMARTSCREEN_DOWNLOAD_URL is required for public SmartScreen launch evidence.',
    );
  }

  const timeoutMs = Number(readEnvAlias(process.env, 'CODEXMUX_SMARTSCREEN_PUBLIC_TIMEOUT_MS') || 300_000);
  const smokeRoot = path.resolve(
    readEnvAlias(process.env, 'CODEXMUX_SMARTSCREEN_PUBLIC_SMOKE_ROOT') ||
    await fsp.mkdtemp(path.join(os.tmpdir(), 'codexwinmux-smartscreen-')),
  );
  const keepSmokeRoot = readEnvAlias(process.env, 'CODEXMUX_SMARTSCREEN_PUBLIC_KEEP_ROOT') === '1';
  const installerPath = path.join(smokeRoot, path.basename(new URL(downloadUrl).pathname));
  const installDir = path.join(smokeRoot, 'install');
  const checks = [];
  let evidence = null;

  try {
    await fsp.mkdir(smokeRoot, { recursive: true });
    const downloadInfo = await downloadWithChromium({ url: downloadUrl, outputPath: installerPath });
    checks.push('public-browser-download-complete');

    const artifactSha256 = await sha256File(installerPath);
    const expectedSha256 = readEnvAlias(process.env, 'CODEXMUX_SMARTSCREEN_EXPECTED_SHA256');
    if (expectedSha256 && artifactSha256.toUpperCase() !== expectedSha256.toUpperCase()) {
      throw new Error('downloaded installer sha256 did not match CODEXWINMUX_SMARTSCREEN_EXPECTED_SHA256');
    }
    checks.push('public-download-sha256-collected');

    const zoneResult = await runPowerShell(`
$ErrorActionPreference = 'Stop'
$zoneText = Get-Content -LiteralPath ${psQuote(installerPath)} -Stream Zone.Identifier -Raw -ErrorAction SilentlyContinue
[PSCustomObject]@{ zoneText = $zoneText } | ConvertTo-Json -Compress
`, { timeoutMs: 30_000 });
    if (zoneResult.exitCode !== 0 || zoneResult.timedOut) {
      throw new Error(`Zone.Identifier check failed: ${JSON.stringify({
        exitCode: zoneResult.exitCode,
        timedOut: zoneResult.timedOut,
        stderr: zoneResult.stderr.slice(-1200),
      })}`);
    }
    const zoneOutput = JSON.parse(zoneResult.stdout || '{}');
    const zoneId = parseZoneId(zoneOutput.zoneText) ?? downloadInfo.zoneId;
    if (zoneId !== 3) {
      throw new Error(`downloaded installer did not retain Internet ZoneId=3; actual ZoneId=${zoneId ?? 'missing'}`);
    }
    checks.push('public-download-internet-zoneid');

    const launchResult = await runPowerShell(`
$ErrorActionPreference = 'Stop'
$process = Start-Process -FilePath ${psQuote(installerPath)} -ArgumentList @('/S', ${psQuote(`/D=${installDir}`)}) -Wait -PassThru -WindowStyle Hidden
[PSCustomObject]@{ started = $true; exitCode = $process.ExitCode } | ConvertTo-Json -Compress
`, { timeoutMs });
    const launch = launchResult.stdout ? JSON.parse(launchResult.stdout) : {
      started: false,
      exitCode: launchResult.exitCode,
      timedOut: launchResult.timedOut,
      error: launchResult.stderr.trim().slice(-800) || null,
    };
    launch.timedOut = launchResult.timedOut;

    evidence = buildWindowsSmartScreenPublicEvidence({
      artifactSha256,
      checkedAt: new Date().toISOString(),
      downloadUrl,
      environment: readEnvAlias(process.env, 'CODEXMUX_SMARTSCREEN_ENVIRONMENT') || 'clean-windows-public-download',
      launch,
      zoneId,
    });
    if (!hasWindowsSmartScreenPublicLaunchEvidence(evidence)) {
      throw new Error(`public SmartScreen launch evidence did not pass: ${JSON.stringify(launch)}`);
    }
    checks.push('public-launch-startprocess-passed');

    const outputPath = readEnvAlias(process.env, 'CODEXMUX_SMARTSCREEN_PUBLIC_EVIDENCE_OUTPUT');
    if (outputPath) {
      await fsp.mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
      await fsp.writeFile(path.resolve(outputPath), `${JSON.stringify(evidence, null, 2)}\n`);
      checks.push('public-evidence-json-written');
    }

    const payload = {
      ok: true,
      checks,
      blockers: [],
      evidence,
      downloadFileName: path.basename(installerPath),
    };
    await writeArtifact('passed', payload);
    console.log(JSON.stringify(buildWindowsSmartScreenPublicEvidencePayload(payload), null, 2));
  } catch (err) {
    const payload = {
      ok: false,
      checks,
      blockers: [{
        ruleId: 'windows-smartscreen-public-evidence-failed',
        message: err instanceof Error ? err.message : String(err),
      }],
      evidence: hasWindowsSmartScreenPublicLaunchEvidence(evidence) ? evidence : null,
      downloadFileName: path.basename(installerPath),
    };
    await writeArtifact('failed', payload);
    console.error(JSON.stringify(buildWindowsSmartScreenPublicEvidencePayload(payload), null, 2));
    process.exitCode = 1;
  } finally {
    const uninstaller = path.join(installDir, 'Uninstall codexwinmux.exe');
    await runPowerShell(`
if (Test-Path -LiteralPath ${psQuote(uninstaller)}) {
  Start-Process -FilePath ${psQuote(uninstaller)} -ArgumentList '/S' -Wait -WindowStyle Hidden
}
`, { timeoutMs: 90_000 }).catch(() => null);
    if (!keepSmokeRoot) {
      await fsp.rm(smokeRoot, { recursive: true, force: true }).catch(() => null);
    }
  }
};

main();
