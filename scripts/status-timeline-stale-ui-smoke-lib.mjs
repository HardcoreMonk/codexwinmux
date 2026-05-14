export const STATUS_TIMELINE_STALE_UI_PROBE_GLOBAL = '__codexwinmuxStatusTimelineStaleUiProbe';

export const normalizeStatusTimelineStaleUiSmokeTimeoutMs = (raw, fallback = 45_000) => {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1_000, Math.min(180_000, Math.trunc(parsed)));
};

export const buildInstallStatusTimelineStaleUiProbeScript = () => `
(() => {
  const globalName = ${JSON.stringify(STATUS_TIMELINE_STALE_UI_PROBE_GLOBAL)};
  if (window[globalName]?.installed) return;
  const NativeWebSocket = window.WebSocket;
  let nextId = 0;
  const state = {
    installed: true,
    events: [],
  };
  const classify = (url) => {
    const value = String(url || '');
    if (value.includes('/api/status')) return 'status';
    if (value.includes('/api/timeline')) return 'timeline';
    return 'other';
  };
  const push = (event) => {
    state.events.push({
      at: Date.now(),
      ...event,
    });
  };
  class CodexwinmuxProbeWebSocket extends NativeWebSocket {
    constructor(url, protocols) {
      super(url, protocols);
      const id = ++nextId;
      const kind = classify(url);
      push({ kind, phase: 'construct', id, url: String(url || '') });
      this.addEventListener('open', () => push({ kind, phase: 'open', id }));
      this.addEventListener('close', () => push({ kind, phase: 'close', id }));
      this.addEventListener('error', () => push({ kind, phase: 'error', id }));
    }
  }
  CodexwinmuxProbeWebSocket.CONNECTING = NativeWebSocket.CONNECTING;
  CodexwinmuxProbeWebSocket.OPEN = NativeWebSocket.OPEN;
  CodexwinmuxProbeWebSocket.CLOSING = NativeWebSocket.CLOSING;
  CodexwinmuxProbeWebSocket.CLOSED = NativeWebSocket.CLOSED;
  window.WebSocket = CodexwinmuxProbeWebSocket;
  window[globalName] = state;
})();
`;

export const buildReadStatusTimelineStaleUiProbeScript = () => `
(() => {
  const events = window.${STATUS_TIMELINE_STALE_UI_PROBE_GLOBAL}.events || [];
  const count = (kind, phase) => events.filter((event) => event.kind === kind && event.phase === phase).length;
  return {
    events,
    counts: {
      statusConstruct: count('status', 'construct'),
      statusOpen: count('status', 'open'),
      statusClose: count('status', 'close'),
      timelineConstruct: count('timeline', 'construct'),
      timelineOpen: count('timeline', 'open'),
      timelineClose: count('timeline', 'close'),
    },
  };
})();
`;

export const buildDispatchNativeAppStateScript = (active) => `
(() => {
  window.dispatchEvent(new CustomEvent('codexmux:native-app-state', { detail: { active: ${active ? 'true' : 'false'} } }));
})();
`;
