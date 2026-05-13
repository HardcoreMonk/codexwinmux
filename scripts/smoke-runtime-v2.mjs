#!/usr/bin/env node
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { WebSocket } from 'ws';
import {
  appendRuntimeV2SmokeFrame,
  hasRuntimeV2SmokeInitialTerminalOutput,
  encodeHeartbeat,
  encodeResize,
  encodeStdin,
  encodeWebStdin,
  isRuntimeV2SmokeHeartbeatFrame,
  runtimeV2SmokeEchoCommand,
  runtimeV2SmokeInitialCommand,
  runtimeV2SmokeWsUrl,
} from './runtime-v2-smoke-lib.mjs';
import { readEnvAlias } from './env-alias-lib.mjs';

const baseUrl = readEnvAlias(process.env, 'CODEXMUX_RUNTIME_V2_SMOKE_URL') || 'http://127.0.0.1:8132';
const token = process.env.CODEXMUX_TOKEN
  || process.env.CMUX_TOKEN
  || await fs.readFile(path.join(os.homedir(), '.codexwinmux', 'cli-token'), 'utf-8').then((s) => s.trim());
const headers = { 'x-cmux-token': token };
const DEFAULT_TIMEOUT_MS = 10_000;

const request = async (pathname, init = {}) => {
  const res = await fetch(new URL(pathname, baseUrl), {
    ...init,
    headers: {
      ...headers,
      ...(init.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`${init.method || 'GET'} ${pathname} failed: ${res.status} ${await res.text()}`);
  return res.json();
};

const waitForSocketOutput = ({ sessionName, label, onOpen, predicate, timeoutMs = DEFAULT_TIMEOUT_MS }) =>
  new Promise((resolve, reject) => {
    let output = '';
    const ws = new WebSocket(runtimeV2SmokeWsUrl(baseUrl, sessionName), { headers });
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      ws.close();
      reject(new Error(`${label} timed out waiting for terminal output; got ${JSON.stringify(output.slice(-200))}`));
    }, timeoutMs);

    ws.on('open', () => {
      onOpen(ws);
    });
    ws.on('message', (data) => {
      output = appendRuntimeV2SmokeFrame(output, data);
      if (predicate(output)) {
        settled = true;
        clearTimeout(timer);
        ws.close();
        resolve(output);
      }
    });
    ws.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    ws.on('close', (code, reason) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`${label} closed before expected output: ${code} ${reason.toString()}; got ${JSON.stringify(output.slice(-200))}`));
    });
  });

const waitForTerminalSmoke = (sessionName, expectedCwd) =>
  waitForSocketOutput({
    sessionName,
    label: 'initial attach',
    onOpen: (ws) => {
      ws.send(encodeResize(100, 30));
      ws.send(encodeStdin(runtimeV2SmokeInitialCommand(process.platform, { cols: 100, rows: 30 })));
    },
    predicate: (output) => hasRuntimeV2SmokeInitialTerminalOutput(output, expectedCwd, 100, 30, { platform: process.platform }),
  });

const waitForReconnectSmoke = (sessionName) =>
  waitForSocketOutput({
    sessionName,
    label: 'fresh reconnect attach',
    onOpen: (ws) => {
      ws.send(encodeStdin(runtimeV2SmokeEchoCommand('runtime-v2-reconnect-ok', process.platform)));
    },
    predicate: (output) => output.includes('runtime-v2-reconnect-ok'),
  });

const waitForWebStdinHeartbeatSmoke = (sessionName) =>
  new Promise((resolve, reject) => {
    const marker = `runtime-v2-web-stdin-ok-${Date.now()}`;
    let output = '';
    let sawHeartbeat = false;
    let settled = false;
    const ws = new WebSocket(runtimeV2SmokeWsUrl(baseUrl, sessionName), { headers });
    const timer = setTimeout(() => {
      settled = true;
      ws.close();
      reject(new Error(`web stdin heartbeat timed out; heartbeat=${sawHeartbeat}; got ${JSON.stringify(output.slice(-200))}`));
    }, DEFAULT_TIMEOUT_MS);
    const finish = () => {
      if (settled || !sawHeartbeat || !output.includes(marker)) return;
      settled = true;
      clearTimeout(timer);
      ws.close();
      resolve({ marker, output });
    };

    ws.on('open', () => {
      ws.send(encodeHeartbeat());
      ws.send(encodeWebStdin(runtimeV2SmokeEchoCommand(marker, process.platform)));
    });
    ws.on('message', (data) => {
      if (isRuntimeV2SmokeHeartbeatFrame(data)) sawHeartbeat = true;
      output = appendRuntimeV2SmokeFrame(output, data);
      finish();
    });
    ws.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    ws.on('close', (code, reason) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`web stdin heartbeat closed before expected output: ${code} ${reason.toString()}; heartbeat=${sawHeartbeat}; got ${JSON.stringify(output.slice(-200))}`));
    });
  });

const waitForFanoutSmoke = (sessionName) =>
  new Promise((resolve, reject) => {
    const marker = `runtime-v2-fanout-ok-${Date.now()}`;
    const sockets = [
      new WebSocket(runtimeV2SmokeWsUrl(baseUrl, sessionName), { headers }),
      new WebSocket(runtimeV2SmokeWsUrl(baseUrl, sessionName), { headers }),
    ];
    const output = ['', ''];
    let openCount = 0;
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      sockets.forEach((ws) => ws.close());
    };
    const fail = (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };
    const maybeResolve = () => {
      if (settled || !output.every((value) => value.includes(marker))) return;
      settled = true;
      cleanup();
      resolve({ marker, output });
    };
    const timer = setTimeout(() => {
      fail(new Error(`fanout timed out; got ${JSON.stringify(output.map((value) => value.slice(-200)))}`));
    }, DEFAULT_TIMEOUT_MS);

    sockets.forEach((ws, index) => {
      ws.on('open', () => {
        openCount += 1;
        if (openCount === sockets.length) {
          sockets[0].send(encodeStdin(runtimeV2SmokeEchoCommand(marker, process.platform)));
        }
      });
      ws.on('message', (data) => {
        output[index] = appendRuntimeV2SmokeFrame(output[index], data);
        maybeResolve();
      });
      ws.on('error', fail);
      ws.on('close', (code, reason) => {
        if (!settled) fail(new Error(`fanout socket ${index} closed early: ${code} ${reason.toString()}`));
      });
    });
  });

const waitForBackpressureSmoke = (sessionName) =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(runtimeV2SmokeWsUrl(baseUrl, sessionName), { headers });
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error('backpressure smoke timed out waiting for close'));
    }, DEFAULT_TIMEOUT_MS);
    ws.on('open', () => {
      ws.send(encodeStdin('x'.repeat(1024 * 1024 + 1)));
    });
    ws.on('message', () => {
      clearTimeout(timer);
      ws.close();
      reject(new Error('backpressure smoke received output before close'));
    });
    ws.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    ws.on('close', (code, reason) => {
      clearTimeout(timer);
      const text = reason.toString();
      if (code !== 1011 || !text.includes('backpressure')) {
        reject(new Error(`backpressure smoke closed with ${code} ${text}, expected 1011 backpressure`));
        return;
      }
      resolve({ code, reason: text });
    });
  });

const waitForAttachRejection = (sessionName) =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(runtimeV2SmokeWsUrl(baseUrl, sessionName), { headers });
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error('cleanup rejection timed out waiting for close'));
    }, DEFAULT_TIMEOUT_MS);
    ws.on('open', () => {
      ws.send(encodeStdin('printf should-not-run\\n\n'));
    });
    ws.on('message', () => {
      clearTimeout(timer);
      ws.close();
      reject(new Error('cleanup rejection received output for a deleted workspace session'));
    });
    ws.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    ws.on('close', (code, reason) => {
      clearTimeout(timer);
      if (code !== 1011) {
        reject(new Error(`cleanup rejection closed with ${code} ${reason.toString()}, expected 1011`));
        return;
      }
      resolve({ code, reason: reason.toString() });
    });
  });

const main = async () => {
  let workspace;
  let tab;
  let failed = false;
  const checks = [];
  try {
    await request('/api/v2/runtime/health');
    checks.push('health');
    workspace = await request('/api/v2/workspaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Runtime V2 Smoke', defaultCwd: process.cwd() }),
    });
    const listed = await request('/api/v2/workspaces');
    if (!listed.workspaces?.some((w) => w.id === workspace.id)) {
      throw new Error(`created workspace not returned by list: ${workspace.id}`);
    }
    checks.push('workspace-list');
    tab = await request('/api/v2/tabs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: workspace.id, paneId: workspace.rootPaneId, cwd: process.cwd() }),
    });
    await waitForTerminalSmoke(tab.sessionName, process.cwd());
    checks.push('attach-stdin-stdout-resize');
    await waitForWebStdinHeartbeatSmoke(tab.sessionName);
    checks.push('web-stdin-heartbeat');
    await waitForReconnectSmoke(tab.sessionName);
    checks.push('fresh-reattach');
    await waitForFanoutSmoke(tab.sessionName);
    checks.push('fanout');
    await waitForBackpressureSmoke(tab.sessionName);
    checks.push('backpressure-close');
    const workspaceId = workspace.id;
    await request(`/api/v2/tabs/${encodeURIComponent(tab.id)}`, { method: 'DELETE' });
    checks.push('tab-delete');
    await waitForAttachRejection(tab.sessionName);
    checks.push('deleted-session-attach-rejected');
    await request(`/api/v2/workspaces/${encodeURIComponent(workspace.id)}`, { method: 'DELETE' });
    checks.push('workspace-delete');
    workspace = null;
    console.log(JSON.stringify({ ok: true, workspaceId, tabId: tab.id, sessionName: tab.sessionName, checks }, null, 2));
  } catch (err) {
    failed = true;
    throw err;
  } finally {
    if (workspace?.id) {
      try {
        await request(`/api/v2/workspaces/${encodeURIComponent(workspace.id)}`, { method: 'DELETE' });
      } catch (err) {
        if (!failed) throw err;
        console.error(`cleanup failed for workspace ${workspace.id}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }
};

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : err);
  process.exit(1);
});
