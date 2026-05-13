export const MSG_STDIN = 0x00;
export const MSG_STDOUT = 0x01;
export const MSG_RESIZE = 0x02;
export const MSG_HEARTBEAT = 0x03;
export const MSG_WEB_STDIN = 0x05;

const encoder = new TextEncoder();

export const encodeStdin = (data) => {
  const payload = encoder.encode(data);
  const frame = new Uint8Array(1 + payload.length);
  frame[0] = MSG_STDIN;
  frame.set(payload, 1);
  return frame;
};

export const encodeWebStdin = (data) => {
  const payload = encoder.encode(data);
  const frame = new Uint8Array(1 + payload.length);
  frame[0] = MSG_WEB_STDIN;
  frame.set(payload, 1);
  return frame;
};

export const encodeResize = (cols, rows) => {
  const frame = new ArrayBuffer(5);
  const view = new DataView(frame);
  view.setUint8(0, MSG_RESIZE);
  view.setUint16(1, cols);
  view.setUint16(3, rows);
  return frame;
};

export const encodeHeartbeat = () => new Uint8Array([MSG_HEARTBEAT]);

export const runtimeV2SmokeWsUrl = (baseUrl, sessionName, { cols = 80, rows = 24 } = {}) => {
  const url = new URL(`/api/v2/terminal?session=${encodeURIComponent(sessionName)}&cols=${cols}&rows=${rows}`, baseUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url;
};

export const resolveRuntimeV2IsolatedSmokePlan = ({
  platform = process.platform,
  targetUrl = '',
} = {}) => {
  const normalizedTargetUrl = String(targetUrl || '').trim();
  if (normalizedTargetUrl) {
    return { kind: 'target-url', targetUrl: normalizedTargetUrl };
  }
  if (platform === 'win32') return { kind: 'windows-terminal' };
  return { kind: 'isolated-server' };
};

export const toRuntimeV2SmokeBuffer = (data) => {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (Array.isArray(data)) return Buffer.concat(data.map(toRuntimeV2SmokeBuffer));
  return Buffer.from(data);
};

export const decodeRuntimeV2SmokeFrame = (data) => {
  const bytes = toRuntimeV2SmokeBuffer(data);
  return {
    type: bytes[0],
    payload: bytes.subarray(1),
  };
};

export const isRuntimeV2SmokeHeartbeatFrame = (data) =>
  decodeRuntimeV2SmokeFrame(data).type === MSG_HEARTBEAT;

export const appendRuntimeV2SmokeFrame = (output, data) => {
  const frame = decodeRuntimeV2SmokeFrame(data);
  if (frame.type !== MSG_STDOUT) return output;
  return `${output}${frame.payload.toString('utf-8')}`;
};

export const runtimeV2SmokeEchoCommand = (marker, platform = process.platform) =>
  platform === 'win32'
    ? `echo ${marker}\r`
    : `printf ${marker}\\n\n`;

export const runtimeV2SmokeInitialCommand = (platform = process.platform, { cols = 100, rows = 30 } = {}) =>
  platform === 'win32'
    ? `cd\r\necho runtime-v2-size ${rows} ${cols}\r`
    : 'pwd\nstty size\n';

export const normalizeRuntimeV2SmokeTerminalOutput = (output) =>
  String(output || '')
    .replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '')
    .replace(/\r/g, '\n');

export const hasRuntimeV2SmokeInitialTerminalOutput = (output, expectedCwd, cols, rows, { platform = 'linux' } = {}) => {
  const normalized = normalizeRuntimeV2SmokeTerminalOutput(output);
  const sizePattern = platform === 'win32'
    ? new RegExp(`(?:^|\\s)runtime-v2-size\\s+${rows}\\s+${cols}(?:\\s|$)`)
    : new RegExp(`(?:^|\\s)${rows}\\s+${cols}(?:\\s|$)`);
  return normalized.includes(expectedCwd) && sizePattern.test(normalized);
};
