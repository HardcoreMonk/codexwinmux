#!/usr/bin/env node
import fs from 'node:fs';
import { fork } from 'node:child_process';
import { writeSmokeArtifact } from './smoke-artifact-lib.mjs';
import {
  buildCoreEngineIpcLaunchPlan,
  buildCoreEngineIpcSmokePayload,
  coreEngineIpcSmokeTimeoutMs,
  createCoreHealthCommand,
} from './core-engine-ipc-smoke-lib.mjs';

const waitForCoreIpc = async (plan) => {
  if (!fs.existsSync(plan.scriptPath)) {
    throw Object.assign(new Error(`Core engine host script is missing: ${plan.scriptPath}`), {
      code: 'core-engine-host-build-missing',
    });
  }

  const child = fork(plan.scriptPath, [], {
    cwd: plan.cwd,
    env: {
      ...process.env,
      ...plan.env,
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    windowsHide: true,
  });

  let eventReceived = false;
  let reply = null;
  let settled = false;

  const closeChild = async () => {
    if (child.connected) child.disconnect();
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (!child.killed) child.kill('SIGTERM');
        resolve();
      }, 5_000);
      child.once('close', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  };

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(Object.assign(new Error('Core engine IPC smoke timed out'), { code: 'core-engine-ipc-timeout' }));
    }, coreEngineIpcSmokeTimeoutMs);

    const finish = async (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try {
        await closeChild();
      } finally {
        resolve(result);
      }
    };

    child.once('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    child.on('message', (message) => {
      if (message?.kind === 'event' && message.type === 'core.health-changed') {
        eventReceived = true;
        child.send(createCoreHealthCommand());
        return;
      }
      if (message?.kind === 'reply' && message.commandId === 'smoke-core-health') {
        reply = message;
        void finish({
          eventReceived,
          reply,
          exitCode: null,
          signal: null,
        });
      }
    });
  });
};

const startedAt = new Date().toISOString();
const startedMs = Date.now();

try {
  const plan = buildCoreEngineIpcLaunchPlan();
  const result = await waitForCoreIpc(plan);
  const endedAt = new Date().toISOString();
  const payload = buildCoreEngineIpcSmokePayload({
    ok: result.reply?.ok === true && result.eventReceived === true,
    eventReceived: result.eventReceived,
    reply: result.reply,
    exitCode: result.exitCode,
    signal: result.signal,
  });
  const artifact = await writeSmokeArtifact({
    smokeName: 'windows-core-engine-ipc',
    status: payload.ok ? 'passed' : 'failed',
    payload: {
      ...payload,
      durationMs: Date.now() - startedMs,
    },
    startedAt,
    endedAt,
  });
  console.log(JSON.stringify({
    ...payload,
    durationMs: Date.now() - startedMs,
    artifact: { written: !artifact.skipped },
  }, null, 2));
  if (!payload.ok) process.exit(1);
} catch (err) {
  const endedAt = new Date().toISOString();
  const payload = buildCoreEngineIpcSmokePayload({
    ok: false,
    eventReceived: false,
    reply: null,
    error: err instanceof Error ? err.message : String(err),
  });
  await writeSmokeArtifact({
    smokeName: 'windows-core-engine-ipc',
    status: 'failed',
    payload: {
      ...payload,
      durationMs: Date.now() - startedMs,
    },
    startedAt,
    endedAt,
  });
  console.error(JSON.stringify({
    ...payload,
    durationMs: Date.now() - startedMs,
  }, null, 2));
  process.exit(1);
}
