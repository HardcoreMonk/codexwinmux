import { useEffect, useRef } from 'react';
import useWorkspaceStore from '@/hooks/use-workspace-store';
import { useLayoutStore, collectPanes } from '@/hooks/use-layout';
import useTabStore from '@/hooks/use-tab-store';
import useConfigStore from '@/hooks/use-config-store';
import useKeybindingsStore from '@/hooks/use-keybindings-store';
import {
  NATIVE_APP_STATE_EVENT,
  readNativeAppStateActive,
  shouldForceForegroundReconnect,
  waitForForegroundReconnectReady,
  wasPageRestored,
} from '@/lib/foreground-reconnect';
import type { ILayoutData } from '@/types/terminal';

const RECONNECT_DELAY = 3000;

const useSync = () => {
  const wsRef = useRef<WebSocket | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(false);
  const connectIdRef = useRef(0);
  const hiddenAtRef = useRef<number | null>(null);
  const nativeBackgroundPausedRef = useRef(false);
  const foregroundReconnectPendingIdRef = useRef<number | null>(null);

  useEffect(() => {
    mountedRef.current = true;

    const refreshVisibleState = () => {
      useWorkspaceStore.getState().syncWorkspaces();
      const activeWsId = useWorkspaceStore.getState().activeWorkspaceId;
      if (activeWsId) {
        useLayoutStore.getState().fetchLayout(activeWsId);
      }
    };

    const connect = () => {
      if (!mountedRef.current) return;
      if (nativeBackgroundPausedRef.current) return;
      foregroundReconnectPendingIdRef.current = null;
      const connectId = ++connectIdRef.current;
      if (wsRef.current && wsRef.current.readyState !== WebSocket.CLOSED) {
        wsRef.current.onclose = null;
        wsRef.current.close(1000);
        wsRef.current = null;
      }
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${location.host}/api/sync`);
      wsRef.current = ws;

      ws.onopen = () => {
        if (connectIdRef.current !== connectId) return;
        refreshVisibleState();
      };

      ws.onmessage = (event) => {
        if (connectIdRef.current !== connectId) return;
        try {
          const data = JSON.parse(event.data);

          if (data.type === 'workspace') {
            useWorkspaceStore.getState().syncWorkspaces();
          }

          if (data.type === 'layout') {
            const activeWsId = useWorkspaceStore.getState().activeWorkspaceId;
            if (data.workspaceId === activeWsId) {
              useLayoutStore.getState().fetchLayout(activeWsId);
            } else if (data.workspaceId) {
              fetch(`/api/layout?workspace=${data.workspaceId}`)
                .then((res) => (res.ok ? res.json() : null))
                .then((layout: ILayoutData | null) => {
                  if (!layout?.root) return;
                  const tabIds = collectPanes(layout.root).flatMap((p) => p.tabs.map((t) => t.id));
                  useTabStore.getState().setTabOrder(data.workspaceId, tabIds);
                })
                .catch(() => {});
            }
          }

          if (data.type === 'config') {
            useConfigStore.getState().syncConfig();
            useKeybindingsStore.getState().load();
          }
        } catch (err) {
          console.log(`[sync-ws] message parse error: ${err instanceof Error ? err.message : err}`);
        }
      };

      ws.onclose = () => {
        if (connectIdRef.current !== connectId) return;
        wsRef.current = null;
        if (nativeBackgroundPausedRef.current) return;
        if (mountedRef.current) {
          timerRef.current = setTimeout(connect, RECONNECT_DELAY);
        }
      };

      ws.onerror = () => {
        ws.close();
      };
    };

    connect();

    const markHidden = () => {
      hiddenAtRef.current = Date.now();
    };

    const pauseForNativeBackground = () => {
      nativeBackgroundPausedRef.current = true;
      foregroundReconnectPendingIdRef.current = null;
      connectIdRef.current++;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close(1000);
        wsRef.current = null;
      }
    };

    const connectWhenForegroundReady = (connectId: number) => {
      foregroundReconnectPendingIdRef.current = connectId;
      void waitForForegroundReconnectReady().finally(() => {
        if (foregroundReconnectPendingIdRef.current !== connectId) return;
        foregroundReconnectPendingIdRef.current = null;
        if (!mountedRef.current) return;
        if (connectIdRef.current !== connectId) return;
        if (nativeBackgroundPausedRef.current) return;
        refreshVisibleState();
        connect();
      });
    };

    const handleForegroundReconnect = (allowHidden = false) => {
      if (!allowHidden && document.visibilityState !== 'visible') return;
      if (foregroundReconnectPendingIdRef.current !== null) return;
      const ws = wsRef.current;
      const forceReconnect = shouldForceForegroundReconnect(hiddenAtRef.current);
      hiddenAtRef.current = null;
      if (!forceReconnect && ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        refreshVisibleState();
        return;
      }
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (forceReconnect) {
        const connectId = ++connectIdRef.current;
        connectWhenForegroundReady(connectId);
        return;
      }
      refreshVisibleState();
      connect();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        markHidden();
        return;
      }
      handleForegroundReconnect();
    };

    const handleForegroundEvent = () => {
      handleForegroundReconnect();
    };

    const handlePageShow = (event: PageTransitionEvent) => {
      if (wasPageRestored(event)) hiddenAtRef.current = 0;
      handleForegroundReconnect();
    };

    const handleNativeAppState = (event: Event) => {
      const active = readNativeAppStateActive(event);
      if (active === false) {
        markHidden();
        pauseForNativeBackground();
        return;
      }
      if (active === true) {
        nativeBackgroundPausedRef.current = false;
        hiddenAtRef.current = 0;
        handleForegroundReconnect(true);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleForegroundEvent);
    window.addEventListener('online', handleForegroundEvent);
    window.addEventListener('pagehide', markHidden);
    window.addEventListener('pageshow', handlePageShow);
    window.addEventListener(NATIVE_APP_STATE_EVENT, handleNativeAppState);

    return () => {
      mountedRef.current = false;
      foregroundReconnectPendingIdRef.current = null;
      // eslint-disable-next-line react-hooks/exhaustive-deps -- invalidate stale socket callbacks on unmount
      connectIdRef.current++;
      if (timerRef.current) clearTimeout(timerRef.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
      }
      wsRef.current = null;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleForegroundEvent);
      window.removeEventListener('online', handleForegroundEvent);
      window.removeEventListener('pagehide', markHidden);
      window.removeEventListener('pageshow', handlePageShow);
      window.removeEventListener(NATIVE_APP_STATE_EVENT, handleNativeAppState);
    };
  }, []);
};

export default useSync;
