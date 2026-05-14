export const BROWSER_SYNC_PROBE_GLOBAL = '__codexwinmuxBrowserSyncSmoke';

export const normalizeBrowserSyncSmokeTimeoutMs = (raw, fallback = 30_000) => {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1_000, Math.min(120_000, Math.floor(parsed)));
};

export const buildInstallBrowserSyncProbeScript = ({
  expectedType,
  workspaceId,
  timeoutMs = 30_000,
}) => {
  const safeTimeoutMs = normalizeBrowserSyncSmokeTimeoutMs(timeoutMs);
  return `(() => {
  const key = ${JSON.stringify(BROWSER_SYNC_PROBE_GLOBAL)};
  const previous = window[key];
  if (previous && previous.socket && previous.socket.readyState < WebSocket.CLOSING) {
    previous.socket.close(1000, 'reset browser sync smoke probe');
  }
  const expectedType = ${JSON.stringify(expectedType)};
  const expectedWorkspaceId = ${JSON.stringify(workspaceId ?? null)};
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(protocol + '//' + location.host + '/api/sync');
  const events = [];
  let readyResolve;
  let eventResolve;
  let eventReject;
  const ready = new Promise((resolve) => {
    readyResolve = resolve;
  });
  const event = new Promise((resolve, reject) => {
    eventResolve = resolve;
    eventReject = reject;
  });
  const timer = setTimeout(() => {
    socket.close(1000, 'browser sync smoke timeout');
    eventReject(new Error('browser sync smoke timed out waiting for ' + expectedType));
  }, ${safeTimeoutMs});
  socket.onopen = () => {
    readyResolve({ opened: true });
  };
  socket.onerror = () => {
    clearTimeout(timer);
    eventReject(new Error('browser sync smoke WebSocket error'));
  };
  socket.onmessage = (message) => {
    let parsed;
    try {
      parsed = JSON.parse(message.data);
    } catch {
      return;
    }
    events.push(parsed);
    if (parsed.type !== expectedType) return;
    if (expectedWorkspaceId && parsed.workspaceId !== expectedWorkspaceId) return;
    clearTimeout(timer);
    eventResolve(parsed);
  };
  window[key] = { socket, events, ready, event };
  return true;
})()`;
};

export const buildReadBrowserSyncProbeReadyScript = () =>
  `window.${BROWSER_SYNC_PROBE_GLOBAL}.ready`;

export const buildReadBrowserSyncProbeEventScript = () =>
  `window.${BROWSER_SYNC_PROBE_GLOBAL}.event`;

