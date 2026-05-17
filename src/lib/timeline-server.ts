import { IncomingMessage } from 'http';
import { WebSocket } from 'ws';
import { watch } from 'fs';
import { existsSync } from 'fs';
import { open as fsOpen, stat as fsStat } from 'fs/promises';
import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import { getSessionPanePid, checkTerminalProcess, sendKeys, getSessionCwd } from './tmux';
import {
  readTabAgentJsonlPath,
  updateTabAgentSessionId,
  updateTabAgentJsonlPath,
  updateTabAgentSummary,
  updateTabLastUserMessage,
  parseSessionName,
} from './layout-store';
import { getStatusManager } from './status-manager';
import { getProviderByPanelType } from '@/lib/providers';
import type { IAgentJsonlResolution, IAgentProvider } from '@/lib/providers';
import { extractSessionIdFromJsonlPath, readSessionStats } from './session-stats';
import { checkCodexJsonlState } from '@/lib/codex-jsonl-state';
import type { TTimelineServerMessage, ISessionStats } from '@/types/timeline';
import path from 'path';
import { isAllowedJsonlPath } from './path-validation';
import { createLogger } from '@/lib/logger';
import {
  broadcastTimelineWatcher as broadcastToWatcher,
  canSendTimelineMessage as canSend,
  fileWatchers,
  type IFileWatcher,
  type ITimelineTailSnapshot,
  type ITimelineConnection,
  sendTimelineJson as sendJson,
  sessionWatchers,
  timelineConnections as connections,
} from '@/lib/timeline-server-state';
import { getPerfNow, recordPerfCounter, recordPerfDuration } from '@/lib/perf-metrics';
import { isRuntimeV2Enabled } from '@/lib/runtime/env';
import {
  recordRuntimeTimelineLiveShadowAppend,
  startRuntimeTimelineLiveShadow,
  stopRuntimeTimelineLiveShadow,
} from '@/lib/runtime/timeline-live-shadow';
import { shouldUseRuntimeTimelineV2Live } from '@/lib/runtime/timeline-mode';
import { handleRuntimeTimelineConnection } from '@/lib/runtime/timeline-ws';
import { getRuntimeStatusV2Mode } from '@/lib/runtime/status-mode';
import { getCoreRuntimeApi } from '@/lib/core-engine/runtime-api';
import { buildTimelineResumeErrorMessage } from '@/lib/resume-error';
import {
  computeInitMeta,
  findLastUserMessage,
  MAX_TIMELINE_INIT_ENTRIES,
} from '@/lib/timeline-file-watcher-service';
import { isTimelineResumeSessionIdValid } from '@/lib/timeline-resume-service';
import { getTimelineSessionConnections } from '@/lib/timeline-subscription-service';

const log = createLogger('timeline');

const HEARTBEAT_INTERVAL = 30_000;
const HEARTBEAT_TIMEOUT = 90_000;
const DEBOUNCE_MS = 50;
const MAX_WATCHERS = 32;
const MAX_CONNECTIONS = 32;
const MAX_WATCHER_RETRIES = 3;
const runtimeConnections = new Set<WebSocket>();

const shouldUseRuntimeStatusLive = (): boolean =>
  isRuntimeV2Enabled() && getRuntimeStatusV2Mode() === 'default';

const getRuntimeTerminalSessionInfo = async (sessionName: string) => {
  if (!isRuntimeV2Enabled()) return null;
  try {
    return await getCoreRuntimeApi().getTerminalSessionInfo(sessionName);
  } catch (err) {
    log.debug('runtime terminal session info lookup failed: %s', err instanceof Error ? err.message : String(err));
    return null;
  }
};

const getTimelineSessionPanePid = async (sessionName: string): Promise<number | null> => {
  const tmuxPanePid = await getSessionPanePid(sessionName);
  if (tmuxPanePid) return tmuxPanePid;

  const runtimeInfo = await getRuntimeTerminalSessionInfo(sessionName);
  return runtimeInfo?.exists && typeof runtimeInfo.pid === 'number' && runtimeInfo.pid > 0
    ? runtimeInfo.pid
    : null;
};

const getTimelineSessionCwd = async (sessionName: string): Promise<string | null> => {
  const tmuxCwd = await getSessionCwd(sessionName);
  if (tmuxCwd) return tmuxCwd;

  const runtimeInfo = await getRuntimeTerminalSessionInfo(sessionName);
  return runtimeInfo?.exists && runtimeInfo.cwd ? runtimeInfo.cwd : null;
};

const notifyStatusLastUserMessage = (sessionName: string, message: string): void => {
  if (shouldUseRuntimeStatusLive()) {
    getCoreRuntimeApi().notifyStatusLiveLastUserMessage({ sessionName, message }).catch((err) => {
      log.warn('runtime status last user message notify failed: %s', err instanceof Error ? err.message : String(err));
    });
    return;
  }
  getStatusManager().notifyLastUserMessage(sessionName, message);
};

const resolveAgentSummary = async (
  _provider: IAgentProvider,
  _sessionName: string,
  jsonlSummary: string | null | undefined,
): Promise<string | null> => {
  return jsonlSummary ?? null;
};

export const broadcastSessionStats = (stats: ISessionStats) => {
  for (const fw of fileWatchers.values()) {
    if (extractSessionIdFromJsonlPath(fw.jsonlPath) !== stats.sessionId) continue;
    for (const ws of fw.connections) {
      sendJson(ws, { type: 'timeline:stats-update', sessionStats: stats });
    }
  }
};

const sendEmptyInit = (ws: WebSocket, sessionId = '', isAgentStarting = false) => {
  sendJson(ws, {
    type: 'timeline:init',
    entries: [],
    sessionId,
    totalEntries: 0,
    startByteOffset: 0,
    hasMore: false,
    ...(isAgentStarting && { isAgentStarting: true }),
  });
};

const subscribeAndUpdateSummary = async (
  ws: WebSocket,
  jsonlPath: string,
  sessionId: string | undefined,
  sessionName: string,
  provider: IAgentProvider,
) => {
  await updateTabAgentJsonlPath(sessionName, provider, jsonlPath).catch(() => {});
  const jsonlSummary = await subscribeToFile(ws, jsonlPath, sessionId, sessionName, provider);
  const summary = await resolveAgentSummary(provider, sessionName, jsonlSummary);
  await updateTabAgentSummary(sessionName, provider, summary).catch(() => {});
};

const readBoundedEntries = async (
  filePath: string, from: number, to: number, provider: IAgentProvider,
): Promise<import('@/types/timeline').ITimelineEntry[]> => {
  const readSize = to - from;
  if (readSize <= 0) return [];
  const handle = await fsOpen(filePath, 'r');
  try {
    const buf = Buffer.alloc(readSize);
    await handle.read(buf, 0, readSize, from);
    return provider.parseJsonlContent(buf.toString('utf-8'));
  } finally {
    await handle.close();
  }
};

const readTailSnapshot = async (
  fw: IFileWatcher,
  jsonlPath: string,
  provider: IAgentProvider,
): Promise<ITimelineTailSnapshot> => {
  const stat = await fsStat(jsonlPath);
  const cached = fw.tailSnapshot;
  if (
    cached
    && cached.maxEntries === MAX_TIMELINE_INIT_ENTRIES
    && cached.fileSize === stat.size
    && cached.mtimeMs === stat.mtimeMs
  ) {
    recordPerfCounter('timeline.tail_cache_hit');
    return cached;
  }

  recordPerfCounter('timeline.tail_cache_miss');
  const startedAt = getPerfNow();
  const result = await provider.readTailEntries(jsonlPath, MAX_TIMELINE_INIT_ENTRIES);
  recordPerfDuration('timeline.read_tail', getPerfNow() - startedAt);
  recordPerfCounter('timeline.read_tail.entries', result.entries.length);

  const firstTimestamp = result.hasMore ? await readFirstTimestamp(jsonlPath) : null;
  const snapshot: ITimelineTailSnapshot = {
    maxEntries: MAX_TIMELINE_INIT_ENTRIES,
    fileSize: result.fileSize,
    mtimeMs: stat.mtimeMs,
    result,
    firstTimestamp,
  };
  fw.tailSnapshot = snapshot;
  return snapshot;
};

const processFileChange = async (fw: IFileWatcher) => {
  if (fw.processing) {
    fw.pendingChange = true;
    return;
  }
  const startedAt = getPerfNow();
  fw.processing = true;
  try {
    const prevOffset = fw.offset;
    fw.tailSnapshot = undefined;
    const parseStartedAt = getPerfNow();
    const { newEntries, newOffset, pendingBuffer } = await fw.provider.parseIncremental(
      fw.jsonlPath, fw.offset, fw.pendingBuffer,
    );
    recordPerfDuration('timeline.parse_incremental', getPerfNow() - parseStartedAt);
    recordPerfCounter('timeline.parse_incremental.entries', newEntries.length);
    fw.pendingBuffer = pendingBuffer;
    if (newEntries.length > 0) {
      fw.offset = newOffset;

      const msg: TTimelineServerMessage = { type: 'timeline:append', entries: newEntries };
      const str = JSON.stringify(msg);
      const partialReads: Promise<void>[] = [];
      for (const ws of fw.connections) {
        if (!canSend(ws)) continue;
        const initOffset = fw.initOffsets.get(ws);
        if (initOffset !== undefined) {
          if (newOffset <= initOffset) {
            continue;
          }
          fw.initOffsets.delete(ws);
          if (prevOffset < initOffset) {
            partialReads.push(
              readBoundedEntries(fw.jsonlPath, initOffset, newOffset, fw.provider)
                .then((entries) => {
                  if (entries.length > 0 && canSend(ws)) {
                    const partialMsg: TTimelineServerMessage = { type: 'timeline:append', entries };
                    ws.send(JSON.stringify(partialMsg));
                  }
                })
                .catch(() => {}),
            );
            continue;
          }
        }
        ws.send(str);
      }
      if (partialReads.length > 0) {
        await Promise.all(partialReads);
      }
      recordRuntimeTimelineLiveShadowAppend(fw.jsonlPath, newEntries);

      const lastMsg = findLastUserMessage(newEntries);
      if (lastMsg) {
        await updateTabLastUserMessage(fw.sessionName, lastMsg).catch(() => {});
        notifyStatusLastUserMessage(fw.sessionName, lastMsg);
      }

      if (!fw.summaryResolved && newEntries.some((e) => e.type === 'assistant-message')) {
        fw.summaryResolved = true;
        const summary = await resolveAgentSummary(fw.provider, fw.sessionName, undefined);
        if (summary) {
          await updateTabAgentSummary(fw.sessionName, fw.provider, summary).catch(() => {});
        }
      }
    }
  } finally {
    recordPerfDuration('timeline.process_file_change', getPerfNow() - startedAt);
    fw.processing = false;
    if (fw.pendingChange) {
      fw.pendingChange = false;
      processFileChange(fw);
    }
  }
};

const startFileWatch = (fw: IFileWatcher) => {
  try {
    fw.watcher = watch(fw.jsonlPath, () => {
      if (fw.debounceTimer) clearTimeout(fw.debounceTimer);
      fw.debounceTimer = setTimeout(() => processFileChange(fw), DEBOUNCE_MS);
    });

    fw.watcher.on('error', () => {
      if (fw.retryCount < MAX_WATCHER_RETRIES) {
        fw.retryCount++;
        if (fw.watcher) fw.watcher.close();
        fw.watcher = null;
        setTimeout(() => startFileWatch(fw), 1000);
      } else {
        broadcastToWatcher(fw.jsonlPath, {
          type: 'timeline:error',
          code: 'watcher-failed',
          message: 'File watch failed (retries exceeded)',
        });
      }
    });
  } catch {
    // File might not exist yet
  }
};

const removeFileWatcher = (jsonlPath: string) => {
  const fw = fileWatchers.get(jsonlPath);
  if (!fw) return;
  if (fw.watcher) fw.watcher.close();
  if (fw.debounceTimer) clearTimeout(fw.debounceTimer);
  fileWatchers.delete(jsonlPath);
  void stopRuntimeTimelineLiveShadow({ jsonlPath });
};

const readFirstTimestamp = async (filePath: string): Promise<string | null> => {
  try {
    const stream = createReadStream(filePath, { encoding: 'utf-8', start: 0, end: 4096 });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        if (obj.timestamp) {
          rl.close();
          stream.destroy();
          return new Date(obj.timestamp).toISOString();
        }
      } catch { /* skip malformed line */ }
      rl.close();
      stream.destroy();
      break;
    }
  } catch { /* file read error */ }
  return null;
};

const subscribeToFile = async (
  ws: WebSocket,
  jsonlPath: string,
  sessionId: string | undefined,
  sessionName: string,
  provider: IAgentProvider,
): Promise<string | undefined> => {
  if (!existsSync(jsonlPath)) {
    const initMessage = {
      type: 'timeline:init' as const,
      entries: [],
      sessionId: sessionId ?? '',
      totalEntries: 0,
      startByteOffset: 0,
      hasMore: false,
      jsonlPath,
    };
    sendJson(ws, initMessage);
    void startRuntimeTimelineLiveShadow({
      jsonlPath,
      sessionName,
      sessionId,
      panelType: provider.panelType,
      expectedInit: initMessage,
    });
    return undefined;
  }

  let fw = fileWatchers.get(jsonlPath);
  const isNewWatcher = !fw;

  if (!fw) {
    if (fileWatchers.size >= MAX_WATCHERS) {
      sendJson(ws, { type: 'timeline:error', code: 'max-watchers', message: 'Too many active watchers' });
      return;
    }
    fw = {
      watcher: null,
      jsonlPath,
      offset: 0,
      pendingBuffer: '',
      connections: new Set(),
      debounceTimer: null,
      retryCount: 0,
      sessionName,
      provider,
      summaryResolved: false,
      processing: false,
      pendingChange: false,
      initOffsets: new Map(),
    };
    fileWatchers.set(jsonlPath, fw);
  }

  fw.connections.add(ws);

  const snapshot = await readTailSnapshot(fw, jsonlPath, provider);
  const result = snapshot.result;

  if (result.errorCount > 0) {
    sendJson(ws, {
      type: 'timeline:error',
      code: 'parse-error',
      message: `JSONL parsing: ${result.errorCount} errors (lines skipped)`,
    });
  }

  if (isNewWatcher) {
    fw.offset = result.fileSize;
    startFileWatch(fw);
  }

  const meta = computeInitMeta(result.entries, result.fileSize, snapshot.firstTimestamp, result.customTitle);

  const resolvedSessionId = sessionId ?? extractSessionIdFromJsonlPath(jsonlPath) ?? '';
  const sessionStats = resolvedSessionId ? await readSessionStats(resolvedSessionId) : null;

  const initMessage = {
    type: 'timeline:init',
    entries: result.entries,
    sessionId: resolvedSessionId,
    totalEntries: result.entries.length,
    startByteOffset: result.startByteOffset,
    hasMore: result.hasMore,
    jsonlPath,
    summary: result.summary,
    meta,
    sessionStats,
  } as const;
  sendJson(ws, initMessage);
  void startRuntimeTimelineLiveShadow({
    jsonlPath,
    sessionName,
    sessionId: resolvedSessionId,
    panelType: provider.panelType,
    expectedInit: initMessage,
  });

  if (!isNewWatcher) {
    fw.initOffsets.set(ws, result.fileSize);
  }

  if (sessionName) {
    const lastMsg = findLastUserMessage(result.entries);
    if (lastMsg) {
      await updateTabLastUserMessage(sessionName, lastMsg).catch(() => {});
      notifyStatusLastUserMessage(sessionName, lastMsg);
    }
  }

  return result.summary;
};

const unsubscribeFromFile = (ws: WebSocket, jsonlPath: string) => {
  const fw = fileWatchers.get(jsonlPath);
  if (!fw) return;
  fw.connections.delete(ws);
  fw.initOffsets.delete(ws);
  if (fw.connections.size === 0) {
    removeFileWatcher(jsonlPath);
  }
};

const getSessionConnections = (sessionName: string): ITimelineConnection[] => {
  return getTimelineSessionConnections(connections, sessionName);
};

const cleanup = (conn: ITimelineConnection) => {
  if (conn.cleaned) return;
  conn.cleaned = true;

  clearInterval(conn.heartbeatTimer);
  connections.delete(conn.ws);

  if (conn.currentJsonlPath) {
    unsubscribeFromFile(conn.ws, conn.currentJsonlPath);
  }

  const wsKey = conn.sessionName;
  const hasOtherConn = getSessionConnections(conn.sessionName).length > 0;
  if (!hasOtherConn) {
    const sw = sessionWatchers.get(wsKey);
    if (sw) {
      sw.stop();
      sessionWatchers.delete(wsKey);
    }
  }
};

const resolveJsonlPath = async (
  provider: IAgentProvider,
  tmuxSession: string,
  sessionId: string,
): Promise<string | null> => {
  const cwd = await getTimelineSessionCwd(tmuxSession);
  if (!cwd) return null;
  const jsonlPath = await provider.resolveJsonlPath(sessionId, cwd);
  if (!jsonlPath) return null;
  return existsSync(jsonlPath) ? jsonlPath : null;
};

const resolveCachedJsonlPath = async (
  sessionName: string,
  provider: IAgentProvider,
): Promise<string | null> => {
  const cached = await readTabAgentJsonlPath(sessionName, provider);
  if (!cached || !isAllowedJsonlPath(cached) || !existsSync(cached)) return null;
  return cached;
};

const statMtimeMs = async (filePath: string | null): Promise<number | null> => {
  if (!filePath) return null;
  try {
    return (await fsStat(filePath)).mtimeMs;
  } catch {
    return null;
  }
};

const resolveLatestCwdJsonl = async (
  provider: IAgentProvider,
  sessionName: string,
  currentJsonlPath: string | null,
): Promise<IAgentJsonlResolution | null> => {
  if (!provider.resolveLatestJsonlPath) return null;

  const cwd = await getTimelineSessionCwd(sessionName);
  if (!cwd) return null;

  const latest = await provider.resolveLatestJsonlPath(cwd);
  if (!latest || !isAllowedJsonlPath(latest.jsonlPath) || !existsSync(latest.jsonlPath)) {
    return null;
  }
  if (latest.jsonlPath === currentJsonlPath) return null;

  const currentMtimeMs = await statMtimeMs(currentJsonlPath);
  if (
    currentMtimeMs !== null
    && latest.mtimeMs !== undefined
    && latest.mtimeMs <= currentMtimeMs
  ) {
    return null;
  }

  return latest;
};

const shouldPreferLatestCwdJsonl = async (
  provider: IAgentProvider,
  currentJsonlPath: string,
): Promise<boolean> => {
  if (provider.id !== 'codex') return false;
  try {
    const state = await checkCodexJsonlState(currentJsonlPath);
    return state.interrupted;
  } catch {
    return false;
  }
};

const resolveActiveOrLatestJsonl = async (
  provider: IAgentProvider,
  sessionName: string,
  activeJsonlPath: string,
  activeSessionId?: string | null,
): Promise<IAgentJsonlResolution> => {
  const latest = await resolveLatestCwdJsonl(provider, sessionName, activeJsonlPath);
  if (latest && await shouldPreferLatestCwdJsonl(provider, activeJsonlPath)) {
    return latest;
  }

  return {
    jsonlPath: activeJsonlPath,
    sessionId: activeSessionId ?? extractSessionIdFromJsonlPath(activeJsonlPath) ?? '',
    mtimeMs: await statMtimeMs(activeJsonlPath) ?? undefined,
  };
};

const resolveStoredOrLatestJsonl = async (
  provider: IAgentProvider,
  sessionName: string,
  sessionId: string | null,
): Promise<IAgentJsonlResolution | null> => {
  const cachedPath = await resolveCachedJsonlPath(sessionName, provider);
  const resolvedPath = cachedPath ?? (sessionId ? await resolveJsonlPath(provider, sessionName, sessionId) : null);
  const latest = sessionId ? await resolveLatestCwdJsonl(provider, sessionName, resolvedPath) : null;
  if (latest) return latest;
  if (!resolvedPath) return null;

  return {
    jsonlPath: resolvedPath,
    sessionId: extractSessionIdFromJsonlPath(resolvedPath) ?? sessionId ?? '',
    mtimeMs: await statMtimeMs(resolvedPath) ?? undefined,
  };
};

const resolveResumeMessage = async (
  ws: WebSocket,
  conn: Pick<ITimelineConnection, 'sessionName' | 'provider'>,
  payload: { sessionId: string; tmuxSession: string },
): Promise<{ jsonlPath: string; sessionId: string } | null | undefined> => {
  const { sessionId, tmuxSession } = payload;

  try {
    const { isSafe, processName } = await checkTerminalProcess(tmuxSession);

    if (!isSafe) {
      sendJson(ws, {
        type: 'timeline:resume-blocked',
        reason: 'process-running',
        processName,
      });
      return undefined;
    }

    const parsed = parseSessionName(tmuxSession);
    let resumeCmd: string;
    try {
      resumeCmd = await conn.provider.buildResumeCommand(sessionId, { workspaceId: parsed?.wsId });
    } catch (err) {
      sendJson(ws, buildTimelineResumeErrorMessage('command-build-failed', err));
      return undefined;
    }

    try {
      await sendKeys(tmuxSession, resumeCmd);
    } catch (err) {
      sendJson(ws, buildTimelineResumeErrorMessage('send-failed', err));
      return undefined;
    }

    await updateTabAgentSessionId(conn.sessionName, conn.provider, sessionId).catch(() => {});

    const jsonlPath = await resolveJsonlPath(conn.provider, tmuxSession, sessionId);

    sendJson(ws, {
      type: 'timeline:resume-started',
      sessionId,
      jsonlPath,
    });

    return jsonlPath ? { jsonlPath, sessionId } : null;
  } catch (err) {
    sendJson(ws, buildTimelineResumeErrorMessage('unknown', err));
    return undefined;
  }
};

const handleResumeMessage = async (
  ws: WebSocket,
  conn: ITimelineConnection,
  payload: { sessionId: string; tmuxSession: string },
) => {
  const resolved = await resolveResumeMessage(ws, conn, payload);

  if (resolved) {
    if (conn.currentJsonlPath) {
      unsubscribeFromFile(ws, conn.currentJsonlPath);
    }
    conn.currentJsonlPath = resolved.jsonlPath;
    await subscribeAndUpdateSummary(ws, resolved.jsonlPath, resolved.sessionId, conn.sessionName, conn.provider);
  } else if (resolved === null) {
    sendEmptyInit(ws, payload.sessionId);
  }
};

export const handleTimelineConnection = async (ws: WebSocket, request: IncomingMessage) => {
  if (connections.size + runtimeConnections.size >= MAX_CONNECTIONS) {
    ws.close(1013, 'Too many connections');
    return;
  }

  const url = new URL(request.url || '', 'http://localhost');
  const sessionName = url.searchParams.get('session') ?? '';

  if (!sessionName) {
    ws.close(1008, 'Missing session parameter');
    return;
  }

  const panelType = url.searchParams.get('panelType') ?? 'codex';
  const provider = getProviderByPanelType(panelType);
  if (!provider) {
    ws.close(1008, 'Unknown panel type');
    return;
  }

  const panePid = await getTimelineSessionPanePid(sessionName);
  if (!panePid) {
    sendEmptyInit(ws);
    ws.close(1000, 'Cannot resolve pane pid');
    return;
  }

  const hintSessionId = url.searchParams.get('agentSessionId');

  if (shouldUseRuntimeTimelineV2Live()) {
    const resumeConn: Pick<ITimelineConnection, 'sessionName' | 'provider'> = {
      sessionName,
      provider,
    };
    runtimeConnections.add(ws);

    const cleanupRuntimeConnection = () => {
      runtimeConnections.delete(ws);
    };
    ws.on('close', cleanupRuntimeConnection);
    ws.on('error', cleanupRuntimeConnection);

    await handleRuntimeTimelineConnection(ws, {
      sessionName,
      panePid,
      panelType,
      provider,
      resolveInitialJsonl: async (info) => {
        if (info.jsonlPath) {
          const resolved = await resolveActiveOrLatestJsonl(provider, sessionName, info.jsonlPath, info.sessionId);
          return {
            jsonlPath: resolved.jsonlPath,
            sessionId: resolved.sessionId,
          };
        }

        const effectiveSessionId = info.sessionId ?? hintSessionId ?? null;
        const resolved = await resolveStoredOrLatestJsonl(provider, sessionName, effectiveSessionId);
        if (!resolved) return null;

        return {
          jsonlPath: resolved.jsonlPath,
          sessionId: resolved.sessionId,
        };
      },
      handleResume: async (payload) => {
        if (!isTimelineResumeSessionIdValid(provider, payload.sessionId)) {
          sendJson(ws, buildTimelineResumeErrorMessage('invalid-session-id'));
          return;
        }
        return resolveResumeMessage(ws, resumeConn, payload);
      },
      updateTabAgentSessionId: async (sessionId) => {
        await updateTabAgentSessionId(sessionName, provider, sessionId).catch(() => {});
      },
      updateTabAgentJsonlPath: async (jsonlPath) => {
        await updateTabAgentJsonlPath(sessionName, provider, jsonlPath).catch(() => {});
      },
    });
    return;
  }

  let lastHeartbeat = Date.now();

  const heartbeatTimer = setInterval(() => {
    if (Date.now() - lastHeartbeat > HEARTBEAT_TIMEOUT) {
      ws.close(1001, 'Heartbeat timeout');
      return;
    }
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping();
    }
  }, HEARTBEAT_INTERVAL);

  const conn: ITimelineConnection = {
    ws,
    sessionName,
    panePid,
    provider,
    heartbeatTimer,
    lastHeartbeat,
    currentJsonlPath: null,
    cleaned: false,
  };

  connections.set(ws, conn);

  ws.on('pong', () => {
    lastHeartbeat = Date.now();
    conn.lastHeartbeat = lastHeartbeat;
  });

  ws.on('message', async (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'timeline:subscribe' && msg.jsonlPath) {
        if (!isAllowedJsonlPath(msg.jsonlPath)) {
          sendJson(ws, { type: 'timeline:error', code: 'forbidden-path', message: 'Not allowed path' });
          return;
        }
        if (conn.currentJsonlPath) {
          unsubscribeFromFile(ws, conn.currentJsonlPath);
        }
        conn.currentJsonlPath = msg.jsonlPath;
        await subscribeToFile(ws, msg.jsonlPath, undefined, conn.sessionName, conn.provider);
      } else if (msg.type === 'timeline:unsubscribe') {
        if (conn.currentJsonlPath) {
          unsubscribeFromFile(ws, conn.currentJsonlPath);
          conn.currentJsonlPath = null;
        }
      } else if (msg.type === 'timeline:resume' && msg.sessionId && msg.tmuxSession) {
        if (!isTimelineResumeSessionIdValid(conn.provider, msg.sessionId)) {
          sendJson(ws, buildTimelineResumeErrorMessage('invalid-session-id'));
        } else {
          await handleResumeMessage(ws, conn, {
            sessionId: msg.sessionId,
            tmuxSession: msg.tmuxSession,
          });
        }
      }
    } catch (err) {
      log.error(`message handler error: ${err instanceof Error ? err.message : err}`);
    }
  });

  ws.on('close', () => cleanup(conn));
  ws.on('error', (err) => {
    log.error(`websocket error: ${err.message}`);
    cleanup(conn);
  });

  const sessionInfo = await provider.detectActiveSession(panePid);

  if (conn.cleaned) return;

  if (sessionInfo.status === 'not-installed') {
    sendJson(ws, { type: 'timeline:error', code: 'not-installed', message: `${provider.displayName} is not installed` });
    sendEmptyInit(ws);
    return;
  }

  // Check if agent process is running in pane before PID file is created
  const isAgentStarting = sessionInfo.status === 'not-running'
    && !hintSessionId
    && await provider.isAgentRunning(panePid);

  if (sessionInfo.status === 'running' && sessionInfo.sessionId) {
    sendJson(ws, {
      type: 'timeline:session-changed',
      newSessionId: sessionInfo.sessionId,
      reason: 'session-waiting',
    });
  } else if (isAgentStarting) {
    sendJson(ws, {
      type: 'timeline:session-changed',
      newSessionId: '',
      reason: 'session-waiting',
    });
  }

  const effectiveSessionId = sessionInfo.sessionId ?? hintSessionId;

  if (sessionInfo.jsonlPath) {
    const resolved = await resolveActiveOrLatestJsonl(provider, sessionName, sessionInfo.jsonlPath, sessionInfo.sessionId);
    const switchedToLatest = resolved.jsonlPath !== sessionInfo.jsonlPath;
    conn.currentJsonlPath = resolved.jsonlPath;
    if (resolved.sessionId) {
      await updateTabAgentSessionId(conn.sessionName, provider, resolved.sessionId).catch(() => {});
    }
    if (switchedToLatest) {
      sendJson(ws, {
        type: 'timeline:session-changed',
        newSessionId: resolved.sessionId,
        reason: 'new-session-started',
      });
    }
    await subscribeAndUpdateSummary(ws, resolved.jsonlPath, resolved.sessionId, conn.sessionName, provider);
  } else if (effectiveSessionId) {
    if (sessionInfo.sessionId) {
      await updateTabAgentSessionId(conn.sessionName, provider, sessionInfo.sessionId).catch(() => {});
    }
    const resolved = await resolveStoredOrLatestJsonl(provider, sessionName, effectiveSessionId);
    if (resolved) {
      conn.currentJsonlPath = resolved.jsonlPath;
      await updateTabAgentSessionId(conn.sessionName, provider, resolved.sessionId).catch(() => {});
      await subscribeAndUpdateSummary(ws, resolved.jsonlPath, resolved.sessionId, conn.sessionName, provider);
    } else {
      sendEmptyInit(ws, effectiveSessionId);
    }
  } else if (!isAgentStarting) {
    sendEmptyInit(ws);
  }

  if (conn.cleaned) return;

  // Watch for new sessions — shared per session key
  const wsKey = sessionName;
  if (!sessionWatchers.has(wsKey)) {
    const sw = provider.watchSessions(panePid, async (newInfo) => {
      const wsConns = getSessionConnections(sessionName);
      for (const c of wsConns) {
        if (newInfo.jsonlPath && newInfo.jsonlPath !== c.currentJsonlPath) {
          const resolved = await resolveActiveOrLatestJsonl(provider, sessionName, newInfo.jsonlPath, newInfo.sessionId);
          if (c.currentJsonlPath) {
            unsubscribeFromFile(c.ws, c.currentJsonlPath);
          }
          c.currentJsonlPath = resolved.jsonlPath;

          if (resolved.sessionId) {
            await updateTabAgentSessionId(sessionName, provider, resolved.sessionId).catch(() => {});
          }

          sendJson(c.ws, {
            type: 'timeline:session-changed',
            newSessionId: resolved.sessionId,
            reason: 'new-session-started',
          });

          await subscribeAndUpdateSummary(c.ws, resolved.jsonlPath, resolved.sessionId, sessionName, provider);
        } else if (!newInfo.jsonlPath && newInfo.status === 'not-running') {
          const latest = await resolveLatestCwdJsonl(provider, sessionName, c.currentJsonlPath);
          if (latest) {
            if (c.currentJsonlPath) {
              unsubscribeFromFile(c.ws, c.currentJsonlPath);
            }
            c.currentJsonlPath = latest.jsonlPath;

            await updateTabAgentSessionId(sessionName, provider, latest.sessionId).catch(() => {});
            sendJson(c.ws, {
              type: 'timeline:session-changed',
              newSessionId: latest.sessionId,
              reason: 'new-session-started',
            });
            await subscribeAndUpdateSummary(c.ws, latest.jsonlPath, latest.sessionId, sessionName, provider);
            continue;
          }

          if (c.currentJsonlPath) {
            unsubscribeFromFile(c.ws, c.currentJsonlPath);
            c.currentJsonlPath = null;
          }
          sendJson(c.ws, {
            type: 'timeline:session-changed',
            newSessionId: '',
            reason: 'session-ended',
          });
        }
      }

      if (newInfo.status === 'running' && !newInfo.jsonlPath) {
        if (newInfo.sessionId) {
          await updateTabAgentSessionId(sessionName, provider, newInfo.sessionId).catch(() => {});
        }
        for (const c of wsConns) {
          if (c.currentJsonlPath) {
            const currentFile = path.basename(c.currentJsonlPath, '.jsonl');
            if (newInfo.sessionId && currentFile !== newInfo.sessionId) {
              unsubscribeFromFile(c.ws, c.currentJsonlPath);
              c.currentJsonlPath = null;
            } else {
              continue;
            }
          }
          sendJson(c.ws, {
            type: 'timeline:session-changed',
            newSessionId: newInfo.sessionId ?? '',
            reason: 'session-waiting',
          });
        }
      }
    }, { skipInitial: true });
    sessionWatchers.set(wsKey, sw);
  }

  // Race condition mitigation for isAgentStarting:
  // If PID file is created between detectActiveSession and isAgentRunning,
  // initial detection misses it and watchSessions won't fire for an existing file.
  // Re-check after watcher setup to cover this gap.
  if (isAgentStarting) {
    const recheckInfo = await provider.detectActiveSession(panePid);
    if (conn.cleaned) return;

    if (recheckInfo.status === 'running' && recheckInfo.sessionId && !conn.currentJsonlPath) {
      await updateTabAgentSessionId(sessionName, provider, recheckInfo.sessionId).catch(() => {});

      if (recheckInfo.jsonlPath) {
        conn.currentJsonlPath = recheckInfo.jsonlPath;
        sendJson(ws, {
          type: 'timeline:session-changed',
          newSessionId: recheckInfo.sessionId,
          reason: 'new-session-started',
        });
        await subscribeAndUpdateSummary(ws, recheckInfo.jsonlPath, recheckInfo.sessionId, sessionName, provider);
      } else if (recheckInfo.cwd) {
        sendJson(ws, {
          type: 'timeline:session-changed',
          newSessionId: recheckInfo.sessionId,
          reason: 'session-waiting',
        });
        sendEmptyInit(ws, recheckInfo.sessionId, true);
      }
    } else {
      sendEmptyInit(ws, '', true);
    }
  }
};

export const gracefulTimelineShutdown = () => {
  for (const ws of runtimeConnections) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.close(1001, 'Server shutting down');
    }
  }
  runtimeConnections.clear();
  for (const [, conn] of connections) {
    if (conn.ws.readyState === WebSocket.OPEN) {
      conn.ws.close(1001, 'Server shutting down');
    }
    cleanup(conn);
  }
  for (const [, sw] of sessionWatchers) {
    sw.stop();
  }
  sessionWatchers.clear();
  for (const [jsonlPath] of fileWatchers) {
    removeFileWatcher(jsonlPath);
  }
};
