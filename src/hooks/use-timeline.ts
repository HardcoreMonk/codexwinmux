import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import type {
  ITimelineEntry,
  IInitMeta,
  ISessionStats,
  ITaskItem,
  TCliState,
  TTimelineConnectionStatus,
  TTimelineResumeErrorReason,
} from '@/types/timeline';
import type { TPanelType } from '@/types/terminal';
import useTimelineWebSocket from '@/hooks/use-timeline-websocket';
import {
  appendTimelineEntries,
  mergeTimelineInitEntries,
  prependUniqueTimelineEntries,
} from '@/lib/timeline-entry-merge';

interface IResumeCallbacks {
  onResumeStarted?: (payload: { sessionId: string; jsonlPath: string | null }) => void;
  onResumeBlocked?: (payload: { reason: string; processName?: string }) => void;
  onResumeError?: (payload: { message: string; reason: TTimelineResumeErrorReason }) => void;
}

export interface ITimelineSyncState {
  agentProcess: boolean | null;
  agentInstalled: boolean;
  isLoading: boolean;
}

interface IUseTimelineOptions {
  sessionName: string;
  agentSessionId?: string | null;
  panelType?: TPanelType;
  enabled: boolean;
  resumeCallbacks?: IResumeCallbacks;
  onSync?: (state: ITimelineSyncState) => void;
  getCliState?: () => TCliState | undefined;
}

const PENDING_AUTOHIDE_DELAY_MS = 1000;
const PENDING_FADE_OUT_DURATION_MS = 200;
const ATTACHMENT_PLACEHOLDER_TIMEOUT_MS = 60_000;

interface IUseTimelineReturn {
  entries: ITimelineEntry[];
  tasks: ITaskItem[];
  sessionId: string | null;
  jsonlPath: string | null;
  sessionSummary: string | undefined;
  initMeta: IInitMeta | undefined;
  sessionStats: ISessionStats | null;
  agentProcess: boolean | null;
  agentInstalled: boolean;
  wsStatus: TTimelineConnectionStatus;
  isLoading: boolean;
  error: string | null;
  loadMore: () => Promise<void>;
  hasMore: boolean;
  retrySession: () => void;
  sendResume: (sessionId: string, tmuxSession: string) => void;
  openJsonlSession: (jsonlPath: string, nextSessionId: string) => boolean;
  addPendingUserMessage: (text: string, options?: { autoHide?: boolean; attachmentPlaceholder?: boolean }) => string;
  removePendingUserMessage: (id: string) => void;
}

const useTimeline = ({
  sessionName,
  agentSessionId,
  panelType,
  enabled,
  resumeCallbacks,
  onSync,
  getCliState,
}: IUseTimelineOptions): IUseTimelineReturn => {
  const [entries, setEntries] = useState<ITimelineEntry[]>([]);
  const [agentProcessState, setAgentProcessState] = useState<boolean | null>(null);
  const [agentInstalledState, setAgentInstalledState] = useState(true);
  const [wsInitReceived, setWsInitReceived] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionSummary, setSessionSummary] = useState<string | undefined>();
  const [initMeta, setInitMeta] = useState<IInitMeta | undefined>();
  const [sessionStats, setSessionStats] = useState<ISessionStats | null>(null);
  const [jsonlPath, setJsonlPath] = useState<string | null>(null);

  const entriesRef = useRef(entries);
  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  const jsonlPathRef = useRef<string | null>(null);
  const startByteOffsetRef = useRef(0);
  const isLoadingMoreRef = useRef(false);
  const pendingAppendRef = useRef<ITimelineEntry[]>([]);
  const appendFlushHandleRef = useRef<number | null>(null);
  const appendFlushModeRef = useRef<'frame' | 'timeout' | null>(null);

  const cancelAppendFlush = useCallback(() => {
    if (appendFlushHandleRef.current === null) return;
    if (appendFlushModeRef.current === 'frame') {
      window.cancelAnimationFrame(appendFlushHandleRef.current);
    } else {
      window.clearTimeout(appendFlushHandleRef.current);
    }
    appendFlushHandleRef.current = null;
    appendFlushModeRef.current = null;
  }, []);

  const flushPendingAppend = useCallback(() => {
    appendFlushHandleRef.current = null;
    appendFlushModeRef.current = null;
    const pending = pendingAppendRef.current;
    if (pending.length === 0) return;
    pendingAppendRef.current = [];
    setEntries((prev) => appendTimelineEntries(prev, pending));
  }, []);

  const getCliStateRef = useRef(getCliState);
  useEffect(() => {
    getCliStateRef.current = getCliState;
  }, [getCliState]);

  const [prevSessionName, setPrevSessionName] = useState(sessionName);
  if (sessionName !== prevSessionName) {
    setPrevSessionName(sessionName);
    cancelAppendFlush();
    pendingAppendRef.current = [];
    setWsInitReceived(false);
    setAgentProcessState(null);
    setAgentInstalledState(true);
    setEntries([]);
    setError(null);
    setHasMore(false);
    setSessionId(null);
    setSessionSummary(undefined);
    setInitMeta(undefined);
    setSessionStats(null);
    setJsonlPath(null);
    jsonlPathRef.current = null;
    startByteOffsetRef.current = 0;
  }

  const isLoading = !wsInitReceived;

  const handleInit = useCallback((newEntries: ITimelineEntry[], _totalEntries: number, initSessionId: string, summary?: string, meta?: IInitMeta, startByteOffset?: number, hasMoreInit?: boolean, jsonlPath?: string | null, isAgentStarting?: boolean, initStats?: ISessionStats | null) => {
    setWsInitReceived(true);
    setAgentInstalledState(true);
    setEntries((prev) => mergeTimelineInitEntries(prev, newEntries));
    startByteOffsetRef.current = startByteOffset ?? 0;
    setHasMore(hasMoreInit ?? false);
    setSessionSummary(summary);
    setInitMeta(meta);
    setSessionStats(initStats ?? null);
    if (jsonlPath) {
      jsonlPathRef.current = jsonlPath;
      setJsonlPath(jsonlPath);
    }
    if (initSessionId) {
      setSessionId(initSessionId);
    } else if (!isAgentStarting) {
      setAgentProcessState(false);
    }
    setError(null);
  }, []);

  const handleAppend = useCallback((newEntries: ITimelineEntry[]) => {
    if (newEntries.length === 0) return;
    pendingAppendRef.current.push(...newEntries);
    if (appendFlushHandleRef.current !== null) return;

    if (typeof window.requestAnimationFrame === 'function') {
      appendFlushModeRef.current = 'frame';
      appendFlushHandleRef.current = window.requestAnimationFrame(flushPendingAppend);
      return;
    }

    appendFlushModeRef.current = 'timeout';
    appendFlushHandleRef.current = window.setTimeout(flushPendingAppend, 16);
  }, [flushPendingAppend]);

  useEffect(() => () => {
    cancelAppendFlush();
    pendingAppendRef.current = [];
  }, [cancelAppendFlush]);

  const addPendingUserMessage = useCallback((text: string, options?: { autoHide?: boolean; attachmentPlaceholder?: boolean }): string => {
    const trimmed = text.trim();
    const id = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    if (!trimmed) return id;
    const pendingEntry: ITimelineEntry = {
      id,
      type: 'user-message',
      timestamp: Date.now(),
      text: trimmed,
      pending: true,
      attachmentPlaceholder: options?.attachmentPlaceholder,
    };
    setEntries((prev) => [...prev, pendingEntry]);

    if (options?.attachmentPlaceholder) {
      setTimeout(() => {
        setEntries((prev) =>
          prev.filter(
            (e) => !(e.id === id && e.type === 'user-message' && e.pending === true && e.attachmentPlaceholder === true),
          ),
        );
      }, ATTACHMENT_PLACEHOLDER_TIMEOUT_MS);
    } else if (options?.autoHide !== false) {
      setTimeout(() => {
        if (getCliStateRef.current?.() !== 'busy') return;
        setEntries((prev) =>
          prev.map((e) =>
            e.id === id && e.type === 'user-message' && e.pending === true
              ? { ...e, fadingOut: true }
              : e,
          ),
        );
        setTimeout(() => {
          setEntries((prev) =>
            prev.filter(
              (e) => !(e.id === id && e.type === 'user-message' && e.pending === true),
            ),
          );
        }, PENDING_FADE_OUT_DURATION_MS);
      }, PENDING_AUTOHIDE_DELAY_MS);
    }
    return id;
  }, []);

  const removePendingUserMessage = useCallback((id: string) => {
    setEntries((prev) =>
      prev.filter(
        (e) => !(e.id === id && e.type === 'user-message' && e.pending === true),
      ),
    );
  }, []);

  const handleSessionChanged = useCallback((newSessionId: string, reason: string) => {
    if (reason === 'session-ended') {
      setAgentProcessState(false);
      setWsInitReceived(true);
      if (panelType === 'codex') {
        return;
      }
      setEntries([]);
      setSessionSummary(undefined);
      setInitMeta(undefined);
      setSessionStats(null);
      setHasMore(false);
      return;
    }
    if (reason === 'session-waiting') {
      if (newSessionId) {
        setAgentProcessState(true);
        setSessionId(newSessionId);
      } else {
        setAgentProcessState(true);
      }
      return;
    }
    setSessionId(newSessionId || null);
    setAgentProcessState(true);
    setEntries([]);
    setSessionSummary(undefined);
    setInitMeta(undefined);
    setSessionStats(null);
    setHasMore(false);
    setWsInitReceived(false);
  }, [panelType]);

  const handleStatsUpdate = useCallback((stats: ISessionStats) => {
    setSessionStats(stats);
  }, []);

  const loadMore = useCallback(async () => {
    if (!jsonlPathRef.current || isLoadingMoreRef.current || !hasMore) return;
    if (startByteOffsetRef.current <= 0) {
      setHasMore(false);
      return;
    }
    isLoadingMoreRef.current = true;
    try {
      const params = new URLSearchParams({
        jsonlPath: jsonlPathRef.current,
        beforeByte: String(startByteOffsetRef.current),
        limit: '128',
      });
      if (panelType) params.set('panelType', panelType);
      const res = await fetch(
        `/api/timeline/entries?${params}`,
      );
      if (!res.ok) return;
      const data = await res.json();
      setEntries((prev) => prependUniqueTimelineEntries(prev, data.entries as ITimelineEntry[]));
      startByteOffsetRef.current = data.startByteOffset;
      setHasMore(data.hasMore);
    } finally {
      isLoadingMoreRef.current = false;
    }
  }, [hasMore, panelType]);

  const handleError = useCallback((err: { code: string; message: string }) => {
    if (err.code === 'not-installed') {
      setAgentInstalledState(false);
      return;
    }
    console.warn(`[timeline] WebSocket error: ${err.code} — ${err.message}`);
  }, []);

  const resumeCallbacksRef = useRef(resumeCallbacks);
  useEffect(() => {
    resumeCallbacksRef.current = resumeCallbacks;
  }, [resumeCallbacks]);

  const handleResumeStarted = useCallback(
    (payload: { sessionId: string; jsonlPath: string | null }) => {
      if (payload.jsonlPath) {
        jsonlPathRef.current = payload.jsonlPath;
      }
      setSessionId(payload.sessionId);
      setAgentProcessState(true);
      setEntries([]);
      setWsInitReceived(false);
      resumeCallbacksRef.current?.onResumeStarted?.(payload);
    },
    [],
  );

  const handleResumeBlocked = useCallback(
    (payload: { reason: string; processName?: string }) => {
      resumeCallbacksRef.current?.onResumeBlocked?.(payload);
    },
    [],
  );

  const handleResumeError = useCallback(
    (payload: { message: string; reason: TTimelineResumeErrorReason }) => {
      resumeCallbacksRef.current?.onResumeError?.(payload);
    },
    [],
  );

  const { status: wsStatus, reconnect, sendResume, subscribe } = useTimelineWebSocket({
    sessionName,
    agentSessionId,
    panelType,
    enabled,
    onInit: handleInit,
    onAppend: handleAppend,
    onSessionChanged: handleSessionChanged,
    onStatsUpdate: handleStatsUpdate,
    onError: handleError,
    onResumeStarted: handleResumeStarted,
    onResumeBlocked: handleResumeBlocked,
    onResumeError: handleResumeError,
  });

  const retrySession = useCallback(() => {
    setError(null);
    reconnect();
  }, [reconnect]);

  const openJsonlSession = useCallback((nextJsonlPath: string, nextSessionId: string): boolean => {
    const didSubscribe = subscribe(nextJsonlPath);
    if (!didSubscribe) return false;

    cancelAppendFlush();
    pendingAppendRef.current = [];
    jsonlPathRef.current = nextJsonlPath;
    startByteOffsetRef.current = 0;
    setJsonlPath(nextJsonlPath);
    setSessionId(nextSessionId);
    setAgentProcessState(true);
    setEntries([]);
    setSessionSummary(undefined);
    setInitMeta(undefined);
    setSessionStats(null);
    setHasMore(false);
    setWsInitReceived(false);
    setError(null);
    return true;
  }, [cancelAppendFlush, subscribe]);

  const onSyncRef = useRef(onSync);
  useEffect(() => { onSyncRef.current = onSync; }, [onSync]);

  useEffect(() => {
    onSyncRef.current?.({
      agentProcess: agentProcessState,
      agentInstalled: agentInstalledState,
      isLoading,
    });
  }, [agentProcessState, agentInstalledState, isLoading]);

  const tasks = useMemo((): ITaskItem[] => {
    const items: ITaskItem[] = [];
    const byId = new Map<string, ITaskItem>();
    let createIndex = 0;

    for (const entry of entries) {
      if (entry.type !== 'task-progress') continue;

      if (entry.action === 'create') {
        createIndex++;
        const item = {
          taskId: entry.taskId || String(createIndex),
          subject: entry.subject ?? '',
          description: entry.description,
          status: entry.status,
        };
        items.push(item);
        byId.set(item.taskId, item);
      } else if (entry.action === 'update') {
        const target = byId.get(entry.taskId);
        if (target) {
          target.status = entry.status;
        }
      }
    }

    return items;
  }, [entries]);

  return {
    entries,
    tasks,
    sessionId,
    jsonlPath,
    sessionSummary,
    initMeta,
    sessionStats,
    agentProcess: agentProcessState,
    agentInstalled: agentInstalledState,
    wsStatus,
    isLoading,
    error,
    loadMore,
    hasMore,
    retrySession,
    sendResume,
    openJsonlSession,
    addPendingUserMessage,
    removePendingUserMessage,
  };
};

export default useTimeline;
