import { describe, expect, it } from 'vitest';
import path from 'path';
import { pathToFileURL } from 'url';

const loadLib = async () => import(pathToFileURL(path.join(process.cwd(), 'scripts/runtime-v2-smoke-lib.mjs')).href);

describe('runtime v2 smoke script helpers', () => {
  it('encodes stdin frames', async () => {
    const { encodeStdin } = await loadLib();
    const frame = encodeStdin('pwd\n');

    expect(frame[0]).toBe(0x00);
    expect(Buffer.from(frame.subarray(1)).toString('utf8')).toBe('pwd\n');
  });

  it('encodes web stdin frames', async () => {
    const { encodeWebStdin } = await loadLib();
    const frame = encodeWebStdin('echo web\n');

    expect(frame[0]).toBe(0x05);
    expect(Buffer.from(frame.subarray(1)).toString('utf8')).toBe('echo web\n');
  });

  it('encodes and detects heartbeat frames', async () => {
    const { encodeHeartbeat, isRuntimeV2SmokeHeartbeatFrame } = await loadLib();
    const frame = encodeHeartbeat();

    expect(Buffer.from(frame)).toEqual(Buffer.from([0x03]));
    expect(isRuntimeV2SmokeHeartbeatFrame(frame)).toBe(true);
    expect(isRuntimeV2SmokeHeartbeatFrame(Buffer.from([0x01, 0x41]))).toBe(false);
  });

  it('encodes resize frames', async () => {
    const { encodeResize } = await loadLib();
    const frame = encodeResize(100, 30);
    const view = new DataView(frame);

    expect(view.getUint8(0)).toBe(0x02);
    expect(view.getUint16(1)).toBe(100);
    expect(view.getUint16(3)).toBe(30);
  });

  it('builds runtime v2 terminal websocket urls', async () => {
    const { runtimeV2SmokeWsUrl } = await loadLib();

    expect(runtimeV2SmokeWsUrl('http://127.0.0.1:8132', 'rtv2-ws-a-pane-b-tab-c', {
      cols: 80,
      rows: 24,
    }).toString()).toBe('ws://127.0.0.1:8132/api/v2/terminal?session=rtv2-ws-a-pane-b-tab-c&cols=80&rows=24');

    expect(runtimeV2SmokeWsUrl('https://codexmux.test/base', 'rtv2-ws-a-pane-b-tab-c', {
      cols: 120,
      rows: 40,
    }).toString()).toBe('wss://codexmux.test/api/v2/terminal?session=rtv2-ws-a-pane-b-tab-c&cols=120&rows=40');
  });

  it('appends stdout payloads from runtime v2 terminal frames', async () => {
    const { appendRuntimeV2SmokeFrame } = await loadLib();
    const stdout = Buffer.concat([Buffer.from([0x01]), Buffer.from('hello', 'utf8')]);
    const heartbeat = Buffer.from([0x03]);

    expect(appendRuntimeV2SmokeFrame('', stdout)).toBe('hello');
    expect(appendRuntimeV2SmokeFrame('hello', heartbeat)).toBe('hello');
  });

  it('detects initial terminal output when stty size follows a shell prompt', async () => {
    const { hasRuntimeV2SmokeInitialTerminalOutput } = await loadLib();
    const output = '/data/projects/codex-zone/codexmux\u001b[K\r\n$ 30 100\u001b[K\r\n$ ';

    expect(hasRuntimeV2SmokeInitialTerminalOutput(output, '/data/projects/codex-zone/codexmux', 100, 30)).toBe(true);
  });

  it('uses Windows-safe commands for runtime terminal smoke markers', async () => {
    const {
      runtimeV2SmokeEchoCommand,
      runtimeV2SmokeInitialCommand,
      hasRuntimeV2SmokeInitialTerminalOutput,
    } = await loadLib();

    expect(runtimeV2SmokeInitialCommand('win32', { cols: 100, rows: 30 })).toBe('cd\r\necho runtime-v2-size 30 100\r');
    expect(runtimeV2SmokeEchoCommand('runtime-v2-ok', 'win32')).toBe('echo runtime-v2-ok\r');
    expect(hasRuntimeV2SmokeInitialTerminalOutput(
      'D:\\data\\projects\\codex-zone\\codexwinmux\r\nruntime-v2-size 30 100\r\n',
      'D:\\data\\projects\\codex-zone\\codexwinmux',
      100,
      30,
      { platform: 'win32' },
    )).toBe(true);
  });

  it('routes default isolated runtime smoke to the Windows terminal gate on win32', async () => {
    const { resolveRuntimeV2IsolatedSmokePlan } = await loadLib();

    expect(resolveRuntimeV2IsolatedSmokePlan({ platform: 'win32', targetUrl: '' })).toEqual({
      kind: 'windows-terminal',
    });
    expect(resolveRuntimeV2IsolatedSmokePlan({ platform: 'linux', targetUrl: '' })).toEqual({
      kind: 'isolated-server',
    });
    expect(resolveRuntimeV2IsolatedSmokePlan({ platform: 'win32', targetUrl: 'http://127.0.0.1:8121' })).toEqual({
      kind: 'target-url',
      targetUrl: 'http://127.0.0.1:8121',
    });
  });
});
