#!/usr/bin/env node
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  runtimeV2Phase6ExpectedModes,
  validateRuntimeV2Phase6Gate,
} from './runtime-v2-phase6-gate-lib.mjs';
import { readEnvAlias } from './env-alias-lib.mjs';

const baseUrl =
  readEnvAlias(process.env, 'CODEXMUX_RUNTIME_V2_PHASE6_GATE_URL') ||
  readEnvAlias(process.env, 'CODEXMUX_RUNTIME_V2_SMOKE_URL') ||
  'http://127.0.0.1:8121';

const token =
  process.env.CODEXMUX_TOKEN ||
  process.env.CMUX_TOKEN ||
  await fs.readFile(path.join(os.homedir(), '.codexwinmux', 'cli-token'), 'utf-8').then((s) => s.trim());

const requestJson = async (pathname) => {
  const res = await fetch(new URL(pathname, baseUrl), {
    headers: { 'x-cmux-token': token },
    signal: AbortSignal.timeout(Number(readEnvAlias(process.env, 'CODEXMUX_RUNTIME_V2_PHASE6_GATE_TIMEOUT_MS') || 10_000)),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(`GET ${pathname} failed: ${res.status} ${text.slice(0, 500)}`);
  }
  return data;
};

const main = async () => {
  const [health, perf] = await Promise.all([
    requestJson('/api/v2/runtime/health'),
    requestJson('/api/debug/perf'),
  ]);
  const result = validateRuntimeV2Phase6Gate({ health, perf });
  const output = {
    ok: result.ok,
    baseUrl,
    expectedModes: runtimeV2Phase6ExpectedModes,
    actualModes: {
      terminalV2Mode: health?.terminalV2Mode ?? null,
      storageV2Mode: health?.storageV2Mode ?? null,
      timelineV2Mode: health?.timelineV2Mode ?? null,
      statusV2Mode: health?.statusV2Mode ?? null,
    },
    checks: result.checks,
    failures: result.failures,
  };

  const text = JSON.stringify(output, null, 2);
  if (!result.ok) {
    console.error(text);
    process.exitCode = 1;
    return;
  }
  console.log(text);
};

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : err);
  process.exit(1);
});
