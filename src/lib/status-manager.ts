import { WebSocket } from 'ws';
import { getWorkspaces } from '@/lib/workspace-store';
import { readLayoutFile, resolveLayoutFile, collectAllTabs, updateTabCliStatus, parseSessionName, setLayoutReconciler } from '@/lib/layout-store';
import { getAllPanesInfo, getListeningPorts, SAFE_SHELLS, getSessionCwd, getSessionPanePid } from '@/lib/tmux';
import { getChildPids } from '@/lib/session-detection';
import {
  detectAnyActiveSession,
  getProviderByPanelType,
} from '@/lib/providers';
import type { IAgentProvider } from '@/lib/providers';
import { formatTabTitle } from '@/lib/tab-title';
import { INTERRUPT_PREFIX, summarizeToolCall } from '@/lib/session-parser';
import { createRateLimitsWatcher } from '@/lib/rate-limits-watcher';
import { createLogger } from '@/lib/logger';
import { capturePaneAtWidth } from '@/lib/capture-at-width';
import { parsePermissionOptions } from '@/lib/permission-prompt';
import { hasCodexInterruptedPrompt } from '@/lib/codex-pane-state';
import type { IPaneInfo } from '@/lib/tmux';
import type { TCliState, TToolName } from '@/types/timeline';
import type { ICurrentAction, TTerminalStatus, ITabStatusEntry, IClientTabStatusEntry, IStatusUpdateMessage, IRateLimitsData, TEventName, ILastEvent } from '@/types/status';
import type { ISessionHistoryEntry } from '@/types/session-history';
import { isAnyDeviceVisible } from '@/lib/push-subscriptions';
import { nanoid } from 'nanoid';
import fs from 'fs/promises';
import { watch, type FSWatcher } from 'fs';
import { readAgentSessionId, readAgentSummary } from '@/lib/agent-tab-fields';
import { checkCodexJsonlState } from '@/lib/codex-jsonl-state';
import { getConfig } from '@/lib/config-store';
import { reduceCodexState, reduceHookState } from '@/lib/status-state-machine';
import { createDedupeKeyStore } from '@/lib/dedupe-key-store';
import { completionKeyFor, normalizeSessionId, resolveAgentSessionId, sessionIdFromJsonlPath } from '@/lib/status-session-mapping';
import { shouldProcessHookEvent } from '@/lib/status-notification-policy';
import { mergeStatusMetadata } from '@/lib/status-metadata';
import { forwardBridgeTraceStatusUpdate } from '@/lib/bridge-trace-forwarder';
import { getPerfNow, recordPerfCounter, recordPerfDuration } from '@/lib/perf-metrics';
import { isRuntimeV2Enabled } from '@/lib/runtime/env';
import { getRuntimeStatusV2Mode } from '@/lib/runtime/status-mode';
import { getCoreRuntimeApi } from '@/lib/core-engine/runtime-api';
import { compareRuntimeStatusShadowDecision } from '@/lib/runtime/status-shadow-compare';
import {
  evaluateStatusClientEvent,
  type IStatusClientEventIntent,
  type IStatusClientEventPolicyInput,
} from '@/lib/status-client-event-policy';
import {
  evaluateStatusSideEffects,
  type IStatusSideEffectIntent,
  type IStatusSideEffectPolicyInput,
} from '@/lib/status-side-effect-policy';
import {
  createStatusSessionHistoryAdapter,
  type IStatusSessionHistoryAdapter,
} from '@/lib/status-session-history-adapter';
import { createStatusWebPushAdapter } from '@/lib/status-web-push-adapter';

const log = createLogger('status');
const hookLog = createLogger('hooks');

interface IReadTabMetadataOptions {
  sessionId?: string | null;
  jsonlPath?: string | null;
  childPids?: number[];
}

type TChildPidCache = Map<number, Promise<number[]>>;

const COMPACT_STALE_MS = 60_000;

const POLL_INTERVAL_SMALL = 30_000;
const POLL_INTERVAL_MEDIUM = 45_000;
const POLL_INTERVAL_LARGE = 60_000;
const TAB_COUNT_MEDIUM = 11;
const TAB_COUNT_LARGE = 21;
const BUSY_STUCK_MS = 10 * 60 * 1000;
const JSONL_TAIL_SIZE = 8192;
const JSONL_EXTENDED_TAIL_SIZE = 131_072;
const STALE_MS_INTERRUPTED = 20_000;
const STALE_MS_AWAITING_API = 90_000;
const PROCESS_RETRY_COUNT = 3;
const JSONL_WATCH_DEBOUNCE_MS = 100;
const CODEX_STOP_RECHECK_MS = 500;

interface IJsonlIdleCache {
  mtimeMs: number;
  idle: boolean;
  stale: boolean;
  needsStaleRecheck: boolean;
  staleMs: number;
  lastAssistantSnippet: string | null;
  currentAction: ICurrentAction | null;
  reset: boolean;
  lastEntryTs: number | null;
  interrupted: boolean;
  completionTurnId: string | null;
}

const MAX_JSONL_CACHE = 256;
const jsonlIdleCache = new Map<string, IJsonlIdleCache>();

const MAX_SNIPPET_LENGTH = 200;

const toCurrentAction = (block: { name?: string; input?: Record<string, unknown> }): ICurrentAction => {
  const toolName = (block.name ?? 'Tool') as TToolName;
  const input = (block.input ?? {}) as Record<string, unknown>;
  return { toolName, summary: summarizeToolCall(toolName, input) };
};

interface IAssistantExtract {
  lastAssistantSnippet: string | null;
  currentAction: ICurrentAction | null;
  reset: boolean;
}

const extractAssistantInfo = (lines: string[]): IAssistantExtract => {
  let userMessageSeen = false;

  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const entry = JSON.parse(lines[i]);
      if (entry.isSidechain) continue;

      if (entry.type === 'user') {
        const c = entry.message?.content;
        const isToolResult = Array.isArray(c) && c.some((b: unknown) => (b as { type?: string }).type === 'tool_result');
        if (!isToolResult) userMessageSeen = true;
        continue;
      }

      if (entry.type !== 'assistant' || !entry.message?.content) continue;

      if (userMessageSeen) return { lastAssistantSnippet: null, currentAction: null, reset: true };

      const content = entry.message.content;
      if (!Array.isArray(content)) continue;

      let lastAssistantSnippet: string | null = null;
      let currentAction: ICurrentAction | null = null;

      for (let j = content.length - 1; j >= 0; j--) {
        const block = content[j];
        if (block.type === 'tool_use') {
          currentAction = toCurrentAction(block);
          break;
        }
        if (block.type === 'text' && block.text?.trim()) {
          const text = block.text.trim();
          currentAction = {
            toolName: null,
            summary: text.length > MAX_SNIPPET_LENGTH ? text.slice(0, MAX_SNIPPET_LENGTH) + '…' : text,
          };
          break;
        }
      }

      for (let j = content.length - 1; j >= 0; j--) {
        if (content[j].type === 'text' && content[j].text?.trim()) {
          const text = content[j].text.trim();
          lastAssistantSnippet = text.length > MAX_SNIPPET_LENGTH
            ? text.slice(0, MAX_SNIPPET_LENGTH) + '…'
            : text;
          break;
        }
      }

      return { lastAssistantSnippet, currentAction, reset: false };
    } catch { continue; }
  }
  return { lastAssistantSnippet: null, currentAction: null, reset: false };
};

interface IScanResult {
  matched: boolean;
  idle: boolean;
  stale: boolean;
  needsStaleRecheck: boolean;
  staleMs: number;
  lastEntryTs: number | null;
  interrupted: boolean;
}

const scanLines = (lines: string[], elapsed: number): IScanResult => {
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const entry = JSON.parse(lines[i]);

      if (entry.isSidechain) continue;

      const entryTs: number | null = entry.timestamp ? new Date(entry.timestamp).getTime() : null;

      if (entry.type === 'system' && (entry.subtype === 'stop_hook_summary' || entry.subtype === 'turn_duration')) {
        return { matched: true, idle: true, stale: false, needsStaleRecheck: false, staleMs: 0, lastEntryTs: entryTs, interrupted: false };
      }

      if (entry.type === 'assistant') {
        const stopReason = entry.message?.stop_reason;
        if (!stopReason) {
          const idle = elapsed > STALE_MS_INTERRUPTED;
          return { matched: true, idle, stale: true, needsStaleRecheck: !idle, staleMs: STALE_MS_INTERRUPTED, lastEntryTs: entryTs, interrupted: false };
        }
        return { matched: true, idle: stopReason !== 'tool_use', stale: false, needsStaleRecheck: false, staleMs: 0, lastEntryTs: entryTs, interrupted: false };
      }

      if (entry.type === 'user') {
        const content = entry.message?.content;
        if (Array.isArray(content) && content.length === 1 && typeof content[0]?.text === 'string' && content[0].text.startsWith(INTERRUPT_PREFIX)) {
          return { matched: true, idle: true, stale: false, needsStaleRecheck: false, staleMs: 0, lastEntryTs: entryTs, interrupted: true };
        }
        const idle = elapsed > STALE_MS_AWAITING_API;
        return { matched: true, idle, stale: true, needsStaleRecheck: !idle, staleMs: STALE_MS_AWAITING_API, lastEntryTs: entryTs, interrupted: false };
      }
    } catch {
      continue;
    }
  }

  return { matched: false, idle: elapsed > STALE_MS_AWAITING_API, stale: true, needsStaleRecheck: elapsed <= STALE_MS_AWAITING_API, staleMs: STALE_MS_AWAITING_API, lastEntryTs: null, interrupted: false };
};

interface IJsonlCheckResult {
  idle: boolean;
  stale: boolean;
  lastAssistantSnippet: string | null;
  currentAction: ICurrentAction | null;
  reset: boolean;
  lastEntryTs: number | null;
  staleMs: number;
  interrupted: boolean;
  completionTurnId: string | null;
}

interface IReadTabMetadataResult extends IJsonlCheckResult {
  jsonlPath: string | null;
  running: boolean;
  sessionId?: string | null;
}

const emptyJsonlCheckResult = (): IJsonlCheckResult => ({
  idle: false,
  stale: false,
  lastAssistantSnippet: null,
  currentAction: null,
  reset: false,
  lastEntryTs: null,
  staleMs: 0,
  interrupted: false,
  completionTurnId: null,
});

const checkJsonlIdle = async (jsonlPath: string): Promise<IJsonlCheckResult> => {
  try {
    const stat = await fs.stat(jsonlPath);
    if (stat.size === 0) return { idle: true, stale: false, lastAssistantSnippet: null, currentAction: null, reset: false, lastEntryTs: null, staleMs: 0, interrupted: false, completionTurnId: null };

    const cached = jsonlIdleCache.get(jsonlPath);
    if (cached && cached.mtimeMs === stat.mtimeMs) {
      jsonlIdleCache.delete(jsonlPath);
      jsonlIdleCache.set(jsonlPath, cached);
      if (cached.idle) return { idle: true, stale: cached.stale, lastAssistantSnippet: cached.lastAssistantSnippet, currentAction: cached.currentAction, reset: cached.reset, lastEntryTs: cached.lastEntryTs, staleMs: cached.staleMs, interrupted: cached.interrupted, completionTurnId: cached.completionTurnId };
      if (cached.needsStaleRecheck) {
        const idle = Date.now() - stat.mtimeMs > cached.staleMs;
        return { idle, stale: true, lastAssistantSnippet: cached.lastAssistantSnippet, currentAction: cached.currentAction, reset: cached.reset, lastEntryTs: cached.lastEntryTs, staleMs: cached.staleMs, interrupted: cached.interrupted, completionTurnId: cached.completionTurnId };
      }
      return { idle: false, stale: false, lastAssistantSnippet: cached.lastAssistantSnippet, currentAction: cached.currentAction, reset: cached.reset, lastEntryTs: cached.lastEntryTs, staleMs: cached.staleMs, interrupted: cached.interrupted, completionTurnId: cached.completionTurnId };
    }

    const handle = await fs.open(jsonlPath, 'r');
    try {
      const elapsed = Date.now() - stat.mtimeMs;

      const readSize = Math.min(stat.size, JSONL_TAIL_SIZE);
      const buffer = Buffer.alloc(readSize);
      await handle.read(buffer, 0, readSize, stat.size - readSize);
      const lines = buffer.toString('utf-8').split('\n').filter((l) => l.trim());

      let scan = scanLines(lines, elapsed);
      let extracted = extractAssistantInfo(lines);

      if (!scan.matched && stat.size > JSONL_TAIL_SIZE) {
        const extSize = Math.min(stat.size, JSONL_EXTENDED_TAIL_SIZE);
        const extBuffer = Buffer.alloc(extSize);
        await handle.read(extBuffer, 0, extSize, stat.size - extSize);
        const extLines = extBuffer.toString('utf-8').split('\n').filter((l) => l.trim());
        scan = scanLines(extLines, elapsed);
        if (!extracted.lastAssistantSnippet && !extracted.currentAction) extracted = extractAssistantInfo(extLines);
      }

      if (jsonlIdleCache.size >= MAX_JSONL_CACHE) {
        jsonlIdleCache.delete(jsonlIdleCache.keys().next().value!);
      }
      jsonlIdleCache.set(jsonlPath, { mtimeMs: stat.mtimeMs, idle: scan.idle, stale: scan.stale, needsStaleRecheck: scan.needsStaleRecheck, staleMs: scan.staleMs, lastAssistantSnippet: extracted.lastAssistantSnippet, currentAction: extracted.currentAction, reset: extracted.reset, lastEntryTs: scan.lastEntryTs, interrupted: scan.interrupted, completionTurnId: null });
      return { idle: scan.idle, stale: scan.stale, lastAssistantSnippet: extracted.lastAssistantSnippet, currentAction: extracted.currentAction, reset: extracted.reset, lastEntryTs: scan.lastEntryTs, staleMs: scan.staleMs, interrupted: scan.interrupted, completionTurnId: null };
    } finally {
      await handle.close();
    }
  } catch {
    return { idle: false, stale: false, lastAssistantSnippet: null, currentAction: null, reset: false, lastEntryTs: null, staleMs: 0, interrupted: false, completionTurnId: null };
  }
};

const checkProviderJsonlIdle = async (
  provider: IAgentProvider,
  jsonlPath: string,
): Promise<IJsonlCheckResult> => {
  if (provider.id !== 'codex') return checkJsonlIdle(jsonlPath);
  const result = await checkCodexJsonlState(jsonlPath);
  return {
    idle: result.idle,
    stale: result.stale,
    lastAssistantSnippet: result.lastAssistantSnippet,
    currentAction: result.currentAction,
    reset: result.reset,
    lastEntryTs: result.lastEntryTs,
    staleMs: 0,
    interrupted: result.interrupted,
    completionTurnId: result.completionTurnId,
  };
};

interface IJsonlStats {
  toolUsage: Record<string, number>;
  touchedFiles: string[];
  lastAssistantText: string | null;
  lastUserText: string | null;
  firstUserTs: number | null;
  lastAssistantTs: number | null;
  turnDurationMs: number | null;
}

interface IStatusPollSnapshot {
  startedAt: string;
  endedAt: string;
  durationMs: number;
  workspaceCount: number;
  paneCount: number;
  scannedTabCount: number;
  providerTabCount: number;
  terminalTabCount: number;
  broadcastUpdateCount: number;
  broadcastRemoveCount: number;
}

const parseJsonlStats = async (jsonlPath: string): Promise<IJsonlStats> => {
  const empty: IJsonlStats = { toolUsage: {}, touchedFiles: [], lastAssistantText: null, lastUserText: null, firstUserTs: null, lastAssistantTs: null, turnDurationMs: null };
  try {
    const stat = await fs.stat(jsonlPath);
    if (stat.size === 0) return empty;

    const handle = await fs.open(jsonlPath, 'r');
    try {
      const readSize = Math.min(stat.size, JSONL_EXTENDED_TAIL_SIZE);
      const buffer = Buffer.alloc(readSize);
      await handle.read(buffer, 0, readSize, stat.size - readSize);
      const lines = buffer.toString('utf-8').split('\n').filter((l) => l.trim());

      const toolUsage: Record<string, number> = {};
      const touchedFiles = new Set<string>();
      let lastAssistantText: string | null = null;
      let lastUserText: string | null = null;
      let lastAssistantTs: number | null = null;
      let firstUserTs: number | null = null;
      let turnDurationMs: number | null = null;

      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const entry = JSON.parse(lines[i]);
          if (entry.type === 'file-history-snapshot') break;
          if (entry.isSidechain) continue;

          if (entry.type === 'system' && entry.subtype === 'turn_duration' && typeof entry.durationMs === 'number' && !turnDurationMs) {
            turnDurationMs = entry.durationMs;
          }

          const ts = entry.timestamp ? new Date(entry.timestamp).getTime() : null;

          if (entry.type === 'user') {
            if (ts) firstUserTs = ts;
            if (!lastUserText && Array.isArray(entry.message?.content)) {
              for (const block of entry.message.content) {
                if (block.type === 'text' && block.text) {
                  lastUserText = block.text;
                  break;
                }
              }
            }
          }

          if (entry.type === 'assistant') {
            if (ts && !lastAssistantTs) lastAssistantTs = ts;
            if (Array.isArray(entry.message?.content)) {
              let msgLastText: string | null = null;
              for (const block of entry.message.content) {
                if (block.type === 'tool_use' && block.name) {
                  toolUsage[block.name] = (toolUsage[block.name] ?? 0) + 1;
                  if ((block.name === 'Edit' || block.name === 'Write') && block.input?.file_path) {
                    touchedFiles.add(String(block.input.file_path));
                  }
                }
                if (block.type === 'text' && block.text) {
                  msgLastText = block.text;
                }
              }
              if (!lastAssistantText && msgLastText) {
                lastAssistantText = msgLastText;
              }
            }
          }
        } catch { continue; }
      }

      return { toolUsage, touchedFiles: [...touchedFiles], lastAssistantText, lastUserText, firstUserTs, lastAssistantTs, turnDurationMs };
    } finally {
      await handle.close();
    }
  } catch {
    return empty;
  }
};

const g = globalThis as unknown as { __ptStatusManager?: StatusManager };

export interface IStatusManagerOptions {
  broadcast?: (event: object, exclude?: WebSocket) => void;
  enableRateLimits?: boolean;
  useRuntimeAdapters?: boolean;
  persistTabCliStatus?: (entry: ITabStatusEntry) => Promise<void> | void;
}

export class StatusManager {
  private tabs = new Map<string, ITabStatusEntry>();
  private pollingTimer: ReturnType<typeof setInterval> | null = null;
  private currentInterval = 0;
  private clients = new Set<WebSocket>();
  private initialized = false;
  private rateLimitsWatcher: ReturnType<typeof createRateLimitsWatcher> | null = null;
  private lastRateLimits: IRateLimitsData | null = null;
  private jsonlWatchers = new Map<string, { watcher: FSWatcher; jsonlPath: string; debounceTimer: ReturnType<typeof setTimeout> | null }>();
  private compactStaleTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private reviewNotificationDedupe = createDedupeKeyStore();
  private sessionHistoryDedupe = createDedupeKeyStore();
  private lastPoll: IStatusPollSnapshot | null = null;
  private sessionHistoryAdapter: IStatusSessionHistoryAdapter;
  private webPushAdapter: ReturnType<typeof createStatusWebPushAdapter>;

  constructor(private readonly options: IStatusManagerOptions = {}) {
    this.sessionHistoryAdapter = createStatusSessionHistoryAdapter({
      shouldUseRuntimeStatusDefault: () => this.shouldUseRuntimeStatusDefault(),
      recordCounter: recordPerfCounter,
      logWarning: (message) => log.warn(message),
    });
    this.webPushAdapter = createStatusWebPushAdapter({
      shouldUseRuntimeStatusDefault: () => this.shouldUseRuntimeStatusDefault(),
      recordCounter: recordPerfCounter,
      logWarning: (message) => log.warn(message),
    });
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    await this.scanAll();
    this.startPolling();

    if (this.options.enableRateLimits !== false) {
      this.rateLimitsWatcher = createRateLimitsWatcher((data) => {
        this.lastRateLimits = data;
        this.broadcast({ type: 'rate-limits:update', data });
      });
      this.rateLimitsWatcher.start();
    }
  }

  private async scanAll(): Promise<void> {
    const { workspaces } = await getWorkspaces();
    const panesInfo = await getAllPanesInfo();
    const childPidCache: TChildPidCache = new Map();
    for (const tabId of [...this.jsonlWatchers.keys()]) {
      this.stopJsonlWatch(tabId);
    }
    this.tabs.clear();

    for (const ws of workspaces) {
      const layout = await readLayoutFile(resolveLayoutFile(ws.id));
      if (!layout) continue;

      const tabs = collectAllTabs(layout.root);
      for (const tab of tabs) {
        const paneInfo = panesInfo.get(tab.sessionName);
        const provider = getProviderByPanelType(tab.panelType);
        const detected = await this.readTabMetadata(paneInfo, provider, {
          sessionId: provider?.readSessionId(tab) ?? null,
          jsonlPath: provider?.readJsonlPath(tab) ?? null,
          childPids: provider ? await this.getCachedChildPids(childPidCache, paneInfo) : undefined,
        });
        const persisted: TCliState = (tab.cliState as TCliState | undefined) ?? 'idle';
        let cliState: TCliState = persisted === 'busy' ? 'unknown' : persisted;
        if (provider?.id === 'codex') {
          if (!detected.running && (cliState === 'unknown' || cliState === 'inactive')) {
            cliState = 'idle';
          } else if (detected.running && !detected.jsonlPath) {
            cliState = 'busy';
          } else if (detected.running && detected.idle && detected.lastAssistantSnippet) {
            cliState = 'ready-for-review';
          } else if (detected.running && !detected.idle) {
            cliState = 'busy';
          }
        }

        const { terminalStatus, listeningPorts } = provider
          ? { terminalStatus: 'idle' as const, listeningPorts: [] as number[] }
          : await this.detectTerminalStatus(paneInfo);
        const currentProcess = paneInfo?.command;
        const paneTitle = paneInfo ? `${paneInfo.command}|${paneInfo.path}` : undefined;
        // lastEvent는 메모리 전용이라 재시작 시 유실. persisted needs-input 복원 시
        // 클라 ack가 seq=0과 매칭할 baseline이 필요하므로 합성한다.
        const syntheticLastEvent: ILastEvent | null = cliState === 'needs-input'
          ? { name: 'notification', at: Date.now(), seq: 0 }
          : null;
        const agentSummary = readAgentSummary(tab);
        const agentSessionId = resolveAgentSessionId({
          detectedSessionId: detected.sessionId,
          jsonlPath: detected.jsonlPath,
          persistedSessionId: readAgentSessionId(tab),
        });
        this.tabs.set(tab.id, {
          cliState,
          workspaceId: ws.id,
          tabName: tab.name || (paneTitle ? formatTabTitle(paneTitle) : ''),
          currentProcess,
          paneTitle,
          tmuxSession: tab.sessionName,
          panelType: tab.panelType,
          terminalStatus,
          listeningPorts,
          agentSummary,
          lastUserMessage: tab.lastUserMessage,
          lastAssistantMessage: detected.lastAssistantSnippet,
          currentAction: detected.currentAction,
          readyForReviewAt: cliState === 'ready-for-review' ? Date.now() : null,
          busySince: null,
          dismissedAt: tab.dismissedAt ?? null,
          agentSessionId,
          jsonlPath: detected.jsonlPath,
          lastEvent: syntheticLastEvent,
          eventSeq: 0,
        });
        if ((cliState === 'needs-input' || cliState === 'unknown') && detected.jsonlPath) {
          this.startJsonlWatch(tab.id, detected.jsonlPath);
        }
        if (provider?.id === 'codex' && detected.jsonlPath) {
          this.startJsonlWatch(tab.id, detected.jsonlPath);
        }
        if (provider?.id === 'codex' && detected.running) {
          const pendingRecovery = await this.recoverPendingInputFromPane(tab.id, { silent: true });
          if (!pendingRecovery.recovered) {
            await this.recoverInterruptedPromptFromPane(tab.id, { silent: true });
          }
        }
        if (cliState === 'unknown') {
          this.resolveUnknown(tab.id).catch((err) => log.warn('resolveUnknown failed: %s', err));
        }
      }
    }
  }

  private async resolveUnknown(tabId: string): Promise<void> {
    const entry = this.tabs.get(tabId);
    if (!entry || entry.cliState !== 'unknown') return;

    const provider = getProviderByPanelType(entry.panelType);
    if (!provider) {
      this.applyCliState(tabId, entry, 'idle', { silent: true, skipHistory: true });
      this.persistToLayout(entry);
      this.broadcastUpdate(tabId, entry);
      return;
    }
    const paneInfo = (await getAllPanesInfo()).get(entry.tmuxSession);
    const childPids = paneInfo?.pid ? await getChildPids(paneInfo.pid) : [];
    const agentRunning = paneInfo?.pid
      ? await provider.isAgentRunning(paneInfo.pid, childPids)
      : false;

    if (!agentRunning) {
      this.applyCliState(tabId, entry, 'idle', { silent: true });
      this.persistToLayout(entry);
      this.broadcastUpdate(tabId, entry);
      return;
    }

    if (entry.jsonlPath) {
      const { idle, stale, lastAssistantSnippet } = await checkProviderJsonlIdle(provider, entry.jsonlPath);
      if (idle && !stale && lastAssistantSnippet) {
        this.applyCliState(tabId, entry, 'ready-for-review', { silent: true, skipHistory: true });
        this.persistToLayout(entry);
        this.broadcastUpdate(tabId, entry);
        return;
      }
    }
  }

  private getCachedChildPids(cache: TChildPidCache, paneInfo: IPaneInfo | undefined): Promise<number[]> {
    if (!paneInfo?.pid) return Promise.resolve([]);

    const existing = cache.get(paneInfo.pid);
    if (existing) return existing;

    const next = getChildPids(paneInfo.pid);
    cache.set(paneInfo.pid, next);
    return next;
  }

  private async readTabMetadata(
    paneInfo: IPaneInfo | undefined,
    provider: IAgentProvider | null,
    options: IReadTabMetadataOptions = {},
  ): Promise<IReadTabMetadataResult> {
    const empty = { ...emptyJsonlCheckResult(), jsonlPath: null, running: false, sessionId: null };
    if (!paneInfo || !paneInfo.pid || !provider) return empty;

    const childPids = options.childPids ?? await getChildPids(paneInfo.pid);
    const running = await provider.isAgentRunning(paneInfo.pid, childPids);
    if (!running) return empty;

    const session = await provider.detectActiveSession(paneInfo.pid, childPids);
    const jsonlPath = session.jsonlPath ?? options.jsonlPath ?? null;
    const sessionId = session.sessionId
      ?? sessionIdFromJsonlPath(jsonlPath)
      ?? normalizeSessionId(options.sessionId);

    if (session.status !== 'running' || !jsonlPath) {
      return { ...emptyJsonlCheckResult(), jsonlPath, running: true, sessionId };
    }

    const result = await checkProviderJsonlIdle(provider, jsonlPath);
    return { ...result, jsonlPath, running: true, sessionId };
  }

  private mergeJsonlMetadata(entry: ITabStatusEntry, metadata: IJsonlCheckResult): boolean {
    const { next, changed } = mergeStatusMetadata(entry, metadata);
    if (changed) {
      entry.currentAction = next.currentAction;
      entry.lastAssistantMessage = next.lastAssistantMessage;
    }
    return changed;
  }

  private reconcileCodexState(
    tabId: string,
    entry: ITabStatusEntry,
    metadata: IReadTabMetadataResult,
  ): boolean {
    if (getProviderByPanelType(entry.panelType)?.id !== 'codex') return false;

    const decision = reduceCodexState({
      currentState: entry.cliState,
      running: metadata.running,
      hasJsonlPath: !!metadata.jsonlPath,
      idle: metadata.idle,
      hasCompletionSnippet: !!metadata.lastAssistantSnippet,
    });
    if (!decision.changed) return false;

    this.applyCliState(tabId, entry, decision.nextState, {
      silent: decision.silent,
      skipHistory: decision.skipHistory,
      completionKey: completionKeyFor({
        completionTurnId: metadata.completionTurnId,
        metadataSessionId: metadata.sessionId,
        entrySessionId: entry.agentSessionId,
        jsonlPath: metadata.jsonlPath,
        tmuxSession: entry.tmuxSession,
      }),
    });
    return true;
  }

  private async detectTerminalStatus(
    paneInfo?: IPaneInfo,
  ): Promise<{ terminalStatus: TTerminalStatus; listeningPorts: number[] }> {
    if (!paneInfo || !paneInfo.pid) return { terminalStatus: 'idle', listeningPorts: [] };

    const ports = await getListeningPorts(paneInfo.pid);
    if (ports.length > 0) return { terminalStatus: 'server', listeningPorts: ports };

    const isShell = SAFE_SHELLS.has(paneInfo.command);
    return { terminalStatus: isShell ? 'idle' : 'running', listeningPorts: [] };
  }

  private getPollingInterval(): number {
    const count = this.tabs.size;
    if (count >= TAB_COUNT_LARGE) return POLL_INTERVAL_LARGE;
    if (count >= TAB_COUNT_MEDIUM) return POLL_INTERVAL_MEDIUM;
    return POLL_INTERVAL_SMALL;
  }

  async rescan(): Promise<void> {
    await this.scanAll();
  }

  startPolling(): void {
    this.stopPolling();
    this.currentInterval = this.getPollingInterval();
    this.pollingTimer = setInterval(() => {
      this.poll().catch((err) => {
        recordPerfCounter('status.poll.errors');
        log.error({ err }, 'Polling error');
      });
    }, this.currentInterval);
  }

  stopPolling(): void {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
      this.currentInterval = 0;
    }
  }

  async poll(): Promise<void> {
    const startedAtMs = Date.now();
    const startedAtPerf = getPerfNow();
    let workspaceCount = 0;
    let paneCount = 0;
    let scannedTabCount = 0;
    let providerTabCount = 0;
    let terminalTabCount = 0;
    let broadcastUpdateCount = 0;
    let broadcastRemoveCount = 0;

    const { workspaces } = await getWorkspaces();
    workspaceCount = workspaces.length;
    const panesInfo = await getAllPanesInfo();
    paneCount = panesInfo.size;
    const childPidCache: TChildPidCache = new Map();
    const knownTabIds = new Set<string>();
    const tabsBeforePoll = new Set(this.tabs.keys());
    const now = Date.now();

    for (const ws of workspaces) {
      const layout = await readLayoutFile(resolveLayoutFile(ws.id));
      if (!layout) continue;

      const tabs = collectAllTabs(layout.root);
      for (const tab of tabs) {
        scannedTabCount++;
        knownTabIds.add(tab.id);
        const existing = this.tabs.get(tab.id);
        const paneInfo = panesInfo.get(tab.sessionName);
        const provider = getProviderByPanelType(tab.panelType);
        if (provider) providerTabCount++;
        else terminalTabCount++;

        const { terminalStatus, listeningPorts } = provider
          ? { terminalStatus: 'idle' as const, listeningPorts: [] as number[] }
          : await this.detectTerminalStatus(paneInfo);
        const currentProcess = paneInfo?.command;
        const newPaneTitle = paneInfo ? `${paneInfo.command}|${paneInfo.path}` : undefined;

        if (!existing) {
          const persisted: TCliState = (tab.cliState as TCliState | undefined) ?? 'idle';
          let initialState: TCliState = persisted === 'busy' ? 'unknown' : persisted;
          const detected = await this.readTabMetadata(paneInfo, provider, {
            sessionId: provider?.readSessionId(tab) ?? null,
            jsonlPath: provider?.readJsonlPath(tab) ?? null,
            childPids: provider ? await this.getCachedChildPids(childPidCache, paneInfo) : undefined,
          });
          if (provider?.id === 'codex') {
            if (!detected.running && (initialState === 'unknown' || initialState === 'inactive')) {
              initialState = 'idle';
            } else if (detected.running && !detected.jsonlPath) {
              initialState = 'busy';
            } else if (detected.running && detected.idle && detected.lastAssistantSnippet) {
              initialState = 'ready-for-review';
            } else if (detected.running && !detected.idle) {
              initialState = 'busy';
            }
          }
          // lastEvent는 메모리 전용이라 재시작 시 유실. persisted needs-input을 복원할 때는
          // 클라이언트 ack가 seq=0과 매칭할 baseline이 필요하므로 합성한다.
          const syntheticLastEvent: ILastEvent | null = initialState === 'needs-input'
            ? { name: 'notification', at: Date.now(), seq: 0 }
            : null;
          const agentSummary = readAgentSummary(tab);
          const agentSessionId = resolveAgentSessionId({
            detectedSessionId: detected.sessionId,
            jsonlPath: detected.jsonlPath,
            persistedSessionId: readAgentSessionId(tab),
          });
          const entry: ITabStatusEntry = {
            cliState: initialState,
            workspaceId: ws.id,
            tabName: tab.name || (newPaneTitle ? formatTabTitle(newPaneTitle) : ''),
            currentProcess,
            paneTitle: newPaneTitle,
            tmuxSession: tab.sessionName,
            panelType: tab.panelType,
            terminalStatus,
            listeningPorts,
            agentSummary,
            lastUserMessage: tab.lastUserMessage,
            lastAssistantMessage: detected.lastAssistantSnippet,
            currentAction: detected.currentAction,
            agentSessionId,
            jsonlPath: detected.jsonlPath,
            lastEvent: syntheticLastEvent,
            eventSeq: 0,
          };
          this.tabs.set(tab.id, entry);
          this.persistToLayout(entry);
          this.broadcastUpdate(tab.id, entry);
          broadcastUpdateCount++;
          if (initialState === 'unknown') {
            this.resolveUnknown(tab.id).catch((err) => log.warn('resolveUnknown failed: %s', err));
          }
          if (provider?.id === 'codex' && detected.jsonlPath) {
            this.startJsonlWatch(tab.id, detected.jsonlPath);
          }
          continue;
        }

        const processChanged = existing.currentProcess !== currentProcess;
        const messageChanged = existing.lastUserMessage !== tab.lastUserMessage;
        const panelTypeChanged = existing.panelType !== tab.panelType;
        const refreshed = await this.readTabMetadata(paneInfo, provider, {
          sessionId: provider?.readSessionId(tab) ?? existing.agentSessionId ?? null,
          jsonlPath: provider?.readJsonlPath(tab) ?? existing.jsonlPath ?? null,
          childPids: provider ? await this.getCachedChildPids(childPidCache, paneInfo) : undefined,
        });
        existing.tabName = tab.name || (newPaneTitle ? formatTabTitle(newPaneTitle) : '');
        existing.currentProcess = currentProcess;
        existing.paneTitle = newPaneTitle;
        existing.workspaceId = ws.id;
        existing.panelType = tab.panelType;
        existing.agentSessionId = resolveAgentSessionId({
          detectedSessionId: refreshed.sessionId,
          jsonlPath: refreshed.jsonlPath,
          persistedSessionId: readAgentSessionId(tab),
          currentSessionId: existing.agentSessionId,
        });
        existing.jsonlPath = refreshed.jsonlPath ?? existing.jsonlPath;
        existing.lastUserMessage = tab.lastUserMessage;
        const metadataChanged = this.mergeJsonlMetadata(existing, refreshed);
        const codexStateChanged = this.reconcileCodexState(tab.id, existing, refreshed);
        if (provider?.id === 'codex' && existing.jsonlPath) {
          this.startJsonlWatch(tab.id, existing.jsonlPath);
        }

        if (processChanged) {
          existing.processRetries = PROCESS_RETRY_COUNT;
        }
        const processRetryNeeded = !processChanged && (existing.processRetries ?? 0) > 0;
        if (processRetryNeeded) {
          existing.processRetries = existing.processRetries! - 1;
        }

        const prevPorts = existing.listeningPorts;
        const portsChanged = prevPorts?.length !== listeningPorts.length
          || listeningPorts.some((p, i) => prevPorts![i] !== p);
        const terminalChanged = existing.terminalStatus !== terminalStatus || portsChanged;
        if (terminalChanged) {
          existing.terminalStatus = terminalStatus;
          existing.listeningPorts = listeningPorts;
        }

        let summaryChanged = false;
        const tabSummary = readAgentSummary(tab);
        if (existing.agentSummary !== tabSummary) {
          existing.agentSummary = tabSummary;
          summaryChanged = true;
        }

        if (existing.cliState === 'busy' && existing.lastEvent
            && now - existing.lastEvent.at > BUSY_STUCK_MS) {
          const childPids = await this.getCachedChildPids(childPidCache, paneInfo);
          const agentRunning = paneInfo?.pid && provider
            ? await provider.isAgentRunning(paneInfo.pid, childPids)
            : false;
          if (!agentRunning) {
            log.info({ tabId: tab.id }, 'busy stuck — agent process gone, forcing idle');
            this.applyCliState(tab.id, existing, 'idle', { silent: true });
            this.persistToLayout(existing);
            this.broadcastUpdate(tab.id, existing);
            broadcastUpdateCount++;
            continue;
          }
        }

        const pendingInputRecovery = provider?.id === 'codex' && refreshed.running
          ? await this.recoverPendingInputFromPane(tab.id)
          : { recovered: false };
        const interruptedPromptRecovery = provider?.id === 'codex' && refreshed.running && !pendingInputRecovery.recovered
          ? await this.recoverInterruptedPromptFromPane(tab.id)
          : { recovered: false };

        if (pendingInputRecovery.recovered || interruptedPromptRecovery.recovered) {
          broadcastUpdateCount++;
        } else if (terminalChanged || processChanged || processRetryNeeded || messageChanged || panelTypeChanged || summaryChanged || metadataChanged || codexStateChanged) {
          this.broadcastUpdate(tab.id, existing);
          broadcastUpdateCount++;
        }
      }
    }

    for (const tabId of tabsBeforePoll) {
      if (!knownTabIds.has(tabId) && this.tabs.has(tabId)) {
        this.stopJsonlWatch(tabId);
        this.tabs.delete(tabId);
        this.broadcastRemove(tabId);
        broadcastRemoveCount++;
      }
    }

    const newInterval = this.getPollingInterval();
    if (this.pollingTimer && newInterval !== this.currentInterval) {
      this.startPolling();
    }

    const durationMs = getPerfNow() - startedAtPerf;
    this.lastPoll = {
      startedAt: new Date(startedAtMs).toISOString(),
      endedAt: new Date().toISOString(),
      durationMs: Number(durationMs.toFixed(2)),
      workspaceCount,
      paneCount,
      scannedTabCount,
      providerTabCount,
      terminalTabCount,
      broadcastUpdateCount,
      broadcastRemoveCount,
    };
    recordPerfDuration('status.poll', durationMs);
  }

  getAllForClient(): Record<string, IClientTabStatusEntry> {
    const result: Record<string, IClientTabStatusEntry> = {};
    for (const [tabId, entry] of this.tabs) {
      result[tabId] = {
        cliState: entry.cliState,
        workspaceId: entry.workspaceId,
        tabName: entry.tabName,
        currentProcess: entry.currentProcess,
        paneTitle: entry.paneTitle,
        panelType: entry.panelType,
        terminalStatus: entry.terminalStatus,
        listeningPorts: entry.listeningPorts,
        agentSummary: entry.agentSummary,
        lastUserMessage: entry.lastUserMessage,
        lastAssistantMessage: entry.lastAssistantMessage,
        currentAction: entry.currentAction,
        readyForReviewAt: entry.readyForReviewAt,
        busySince: entry.busySince,
        dismissedAt: entry.dismissedAt,
        agentSessionId: entry.agentSessionId,
        lastEvent: entry.lastEvent,
        eventSeq: entry.eventSeq,
        approvalPromptMetadata: entry.approvalPromptMetadata,
      };
    }
    return result;
  }

  getPerfSnapshot() {
    const stateCounts: Record<TCliState, number> = {
      idle: 0,
      busy: 0,
      inactive: 0,
      'ready-for-review': 0,
      'needs-input': 0,
      cancelled: 0,
      unknown: 0,
    };
    const providerCounts: Record<string, number> = {};
    let providerTabCount = 0;
    let terminalTabCount = 0;
    let openClients = 0;
    let totalBufferedAmount = 0;
    let maxBufferedAmount = 0;

    for (const entry of this.tabs.values()) {
      stateCounts[entry.cliState] += 1;
      const provider = getProviderByPanelType(entry.panelType);
      if (provider) {
        providerTabCount++;
        providerCounts[provider.id] = (providerCounts[provider.id] ?? 0) + 1;
      } else {
        terminalTabCount++;
      }
    }

    for (const ws of this.clients) {
      if (ws.readyState === WebSocket.OPEN) openClients++;
      totalBufferedAmount += ws.bufferedAmount;
      maxBufferedAmount = Math.max(maxBufferedAmount, ws.bufferedAmount);
    }

    return {
      tabs: this.tabs.size,
      providerTabs: providerTabCount,
      terminalTabs: terminalTabCount,
      stateCounts,
      providerCounts,
      clients: this.clients.size,
      openClients,
      bufferedAmount: {
        total: totalBufferedAmount,
        max: maxBufferedAmount,
      },
      jsonlWatchers: this.jsonlWatchers.size,
      compactStaleTimers: this.compactStaleTimers.size,
      currentIntervalMs: this.currentInterval,
      lastPoll: this.lastPoll,
    };
  }

  private applyCliState(
    tabId: string,
    entry: ITabStatusEntry,
    newState: TCliState,
    opts: { silent?: boolean; skipHistory?: boolean; completionKey?: string | null } = {},
  ): void {
    const prevState = entry.cliState;
    if (prevState === newState) return;
    const prevBusySince = entry.busySince;
    const provider = getProviderByPanelType(entry.panelType);
    const wantsSessionHistory = newState === 'ready-for-review' && !!entry.jsonlPath && !opts.skipHistory;
    const wantsReviewNotification = newState === 'ready-for-review' && !opts.silent;
    const sideEffectInput: IStatusSideEffectPolicyInput = {
      previousState: prevState,
      newState,
      ...(opts.silent !== undefined ? { silent: opts.silent } : {}),
      ...(opts.skipHistory !== undefined ? { skipHistory: opts.skipHistory } : {}),
      hasJsonlPath: !!entry.jsonlPath,
      providerId: provider?.id ?? null,
      hasJsonlWatcher: this.jsonlWatchers.has(tabId),
      sessionHistoryDedupeAccepted: wantsSessionHistory
        ? this.sessionHistoryDedupe.remember(opts.completionKey)
        : false,
      reviewNotificationDedupeAccepted: wantsReviewNotification
        ? this.reviewNotificationDedupe.remember(opts.completionKey)
        : false,
    };
    const sideEffects = evaluateStatusSideEffects(sideEffectInput);
    this.shadowStatusSideEffects(sideEffectInput, sideEffects);
    const now = Date.now();
    entry.cliState = newState;
    entry.readyForReviewAt = sideEffects.setReadyForReviewAt ? now : null;
    entry.busySince = sideEffects.setBusySince ? now : null;
    if (newState !== 'needs-input') entry.approvalPromptMetadata = null;
    if (sideEffects.clearDismissedAt) entry.dismissedAt = null;

    if (sideEffects.saveSessionHistory) {
      const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
      delay(500).then(() => this.saveSessionHistory(tabId, entry, prevBusySince, false)).catch((err) => {
        log.warn('Failed to save session history: %s', err);
      });
    }

    if (sideEffects.sendReviewNotification) {
      this.sendWebPush(tabId, entry, 'review').catch((err) => {
        log.warn('Web push failed: %s', err);
      });
    }

    if (sideEffects.sendNeedsInputNotification) {
      this.sendWebPush(tabId, entry, 'needs-input').catch((err) => {
        log.warn('Web push failed: %s', err);
      });
    }

    if (sideEffects.startJsonlWatch) {
      this.startJsonlWatch(tabId, entry.jsonlPath!);
    } else if (sideEffects.stopJsonlWatch) {
      this.stopJsonlWatch(tabId);
    }
  }

  private shadowStatusSideEffects(
    input: IStatusSideEffectPolicyInput,
    expected: IStatusSideEffectIntent,
  ): void {
    if (!isRuntimeV2Enabled() || getRuntimeStatusV2Mode() !== 'shadow') return;

    getCoreRuntimeApi().evaluateStatusSideEffects(input).then((actual) => {
      const comparison = compareRuntimeStatusShadowDecision('side-effect', expected, actual);
      if (comparison.ok) {
        recordPerfCounter('runtime_v2.status_shadow.side_effect.match');
        return;
      }
      recordPerfCounter('runtime_v2.status_shadow.side_effect.mismatch');
      log.warn({ mismatches: comparison.mismatches }, 'runtime v2 status side-effect shadow mismatch');
    }).catch((err) => {
      recordPerfCounter('runtime_v2.status_shadow.side_effect.error');
      log.warn('runtime v2 status side-effect shadow failed: %s', err instanceof Error ? err.message : String(err));
    });
  }

  private async saveSessionHistory(tabId: string, entry: ITabStatusEntry, prevBusySince: number | null | undefined, cancelled: boolean): Promise<void> {
    if (!entry.lastUserMessage) return;

    const stats = entry.jsonlPath ? await parseJsonlStats(entry.jsonlPath) : null;
    const { workspaces } = await getWorkspaces();
    const ws = workspaces.find((w) => w.id === entry.workspaceId);
    const now = Date.now();
    const startedAt = stats?.firstUserTs ?? prevBusySince ?? now;
    const completedAt = cancelled ? now : (stats?.lastAssistantTs ?? now);
    const duration = cancelled
      ? completedAt - startedAt
      : (stats?.turnDurationMs ?? (completedAt - startedAt));

    const historyEntry: ISessionHistoryEntry = {
      id: nanoid(),
      workspaceId: entry.workspaceId,
      workspaceName: ws?.name ?? entry.workspaceId,
      workspaceDir: ws?.directories[0] ?? null,
      tabId,
      agentSessionId: entry.agentSessionId ?? null,
      prompt: stats?.lastUserText ?? entry.lastUserMessage,
      result: stats?.lastAssistantText ?? null,
      startedAt,
      completedAt,
      duration,
      dismissedAt: completedAt,
      toolUsage: stats?.toolUsage ?? {},
      touchedFiles: stats?.touchedFiles ?? [],
      ...(cancelled ? { cancelled: true } : {}),
    };

    await this.addSessionHistoryEntry(historyEntry);
    this.broadcast({ type: 'session-history:update', entry: historyEntry });
  }

  private shouldUseRuntimeStatusDefault(): boolean {
    return this.options.useRuntimeAdapters !== false
      && isRuntimeV2Enabled()
      && getRuntimeStatusV2Mode() === 'default';
  }

  private async addSessionHistoryEntry(entry: ISessionHistoryEntry): Promise<void> {
    await this.sessionHistoryAdapter.addEntry(entry);
  }

  private async updateSessionHistoryDismissedAt(
    tabId: string,
    dismissedAt: number,
  ): Promise<ISessionHistoryEntry | null> {
    return this.sessionHistoryAdapter.updateDismissedAt(tabId, dismissedAt);
  }

  dismissTab(tabId: string, exclude?: WebSocket): boolean {
    const entry = this.tabs.get(tabId);
    if (!entry) return false;

    const clientEventInput: IStatusClientEventPolicyInput = {
      eventType: 'dismiss-tab',
      currentState: entry.cliState,
      lastEventName: entry.lastEvent?.name ?? null,
      lastEventSeq: entry.lastEvent?.seq ?? null,
      clientSeq: null,
    };
    const clientEvent = evaluateStatusClientEvent(clientEventInput);
    this.shadowStatusClientEvent(clientEventInput, clientEvent);
    if (!clientEvent.accepted || clientEvent.nextState !== 'idle') return false;

    const dismissedAt = Date.now();
    this.applyCliState(tabId, entry, 'idle', { silent: true });
    if (clientEvent.setDismissedAt) entry.dismissedAt = dismissedAt;
    if (clientEvent.persistLayout) this.persistToLayout(entry);
    if (clientEvent.broadcastUpdate) this.broadcastUpdate(tabId, entry, exclude);

    if (clientEvent.updateSessionHistoryDismissedAt) {
      this.updateSessionHistoryDismissedAt(tabId, dismissedAt).then((updated) => {
        if (updated) this.broadcast({ type: 'session-history:update', entry: updated });
      }).catch((err) => {
        log.warn('Failed to update session history dismissedAt: %s', err);
      });
    }
    return true;
  }

  ackNotificationInput(tabId: string, seq: number): boolean {
    const entry = this.tabs.get(tabId);
    if (!entry) return false;
    const clientEventInput: IStatusClientEventPolicyInput = {
      eventType: 'ack-notification',
      currentState: entry.cliState,
      lastEventName: entry.lastEvent?.name ?? null,
      lastEventSeq: entry.lastEvent?.seq ?? null,
      clientSeq: seq,
    };
    const clientEvent = evaluateStatusClientEvent(clientEventInput);
    this.shadowStatusClientEvent(clientEventInput, clientEvent);
    if (!clientEvent.accepted || clientEvent.nextState !== 'busy') return false;

    hookLog.debug({ tabId, seq }, 'ack: needs-input→busy');
    this.applyCliState(tabId, entry, 'busy');
    if (clientEvent.persistLayout) this.persistToLayout(entry);
    if (clientEvent.broadcastUpdate) this.broadcastUpdate(tabId, entry);
    return true;
  }

  private shadowStatusClientEvent(
    input: IStatusClientEventPolicyInput,
    expected: IStatusClientEventIntent,
  ): void {
    if (!isRuntimeV2Enabled() || getRuntimeStatusV2Mode() !== 'shadow') return;

    getCoreRuntimeApi().evaluateStatusClientEvent(input).then((actual) => {
      const comparison = compareRuntimeStatusShadowDecision('client-event', expected, actual);
      if (comparison.ok) {
        recordPerfCounter('runtime_v2.status_shadow.client_event.match');
        return;
      }
      recordPerfCounter('runtime_v2.status_shadow.client_event.mismatch');
      log.warn({ mismatches: comparison.mismatches }, 'runtime v2 status client-event shadow mismatch');
    }).catch((err) => {
      recordPerfCounter('runtime_v2.status_shadow.client_event.error');
      log.warn('runtime v2 status client-event shadow failed: %s', err instanceof Error ? err.message : String(err));
    });
  }

  private async recoverPendingInputFromPane(
    tabId: string,
    opts: { silent?: boolean } = {},
  ): Promise<{ recovered: boolean; reason?: string }> {
    const entry = this.tabs.get(tabId);
    if (!entry) return { recovered: false, reason: 'no-entry' };
    if (entry.cliState !== 'unknown' && entry.cliState !== 'busy' && entry.cliState !== 'idle') {
      return { recovered: false, reason: 'not-pending-state' };
    }
    if (getProviderByPanelType(entry.panelType)?.id !== 'codex') {
      return { recovered: false, reason: 'not-codex' };
    }

    const content = await capturePaneAtWidth(entry.tmuxSession, 120, 50).catch((err) => {
      log.warn('recoverUnknownIfPending capture failed: %s', err);
      return null;
    });
    if (!content) return { recovered: false, reason: 'capture-failed' };

    const { options, metadata } = parsePermissionOptions(content);
    if (options.length === 0) return { recovered: false, reason: 'no-options' };
    entry.approvalPromptMetadata = metadata;

    const now = Date.now();
    const seq = (entry.eventSeq ?? 0) + 1;
    entry.eventSeq = seq;
    entry.lastEvent = { name: 'notification', at: now, seq };

    hookLog.debug({ tabId, seq, options: options.length }, 'recover pending→needs-input from pane capture');
    this.applyCliState(tabId, entry, 'needs-input', { silent: opts.silent });
    this.persistToLayout(entry);
    this.broadcastUpdate(tabId, entry);
    return { recovered: true };
  }

  private async recoverInterruptedPromptFromPane(
    tabId: string,
    opts: { silent?: boolean } = {},
  ): Promise<{ recovered: boolean; reason?: string }> {
    const entry = this.tabs.get(tabId);
    if (!entry) return { recovered: false, reason: 'no-entry' };
    if (entry.cliState !== 'unknown' && entry.cliState !== 'busy') {
      return { recovered: false, reason: 'not-pending-state' };
    }
    if (getProviderByPanelType(entry.panelType)?.id !== 'codex') {
      return { recovered: false, reason: 'not-codex' };
    }

    const content = await capturePaneAtWidth(entry.tmuxSession, 120, 50).catch((err) => {
      log.warn('recoverInterruptedPromptFromPane capture failed: %s', err);
      return null;
    });
    if (!content) return { recovered: false, reason: 'capture-failed' };
    if (!hasCodexInterruptedPrompt(content)) return { recovered: false, reason: 'not-interrupted-prompt' };

    const now = Date.now();
    const seq = (entry.eventSeq ?? 0) + 1;
    entry.eventSeq = seq;
    entry.lastEvent = { name: 'interrupt', at: now, seq };
    entry.lastInterruptTs = now;
    entry.currentAction = null;

    hookLog.debug({ tabId, seq }, 'recover busy→idle from Codex interrupted prompt');
    this.applyCliState(tabId, entry, 'idle', {
      silent: opts.silent ?? true,
      skipHistory: true,
    });
    this.persistToLayout(entry);
    this.broadcastUpdate(tabId, entry);
    return { recovered: true };
  }

  async recoverUnknownIfPending(tabId: string): Promise<{ recovered: boolean; reason?: string }> {
    const entry = this.tabs.get(tabId);
    if (!entry) return { recovered: false, reason: 'no-entry' };
    if (entry.cliState !== 'unknown') return { recovered: false, reason: 'not-unknown' };
    return this.recoverPendingInputFromPane(tabId, { silent: true });
  }

  private findTabIdBySession(tmuxSession: string): string | undefined {
    for (const [tabId, entry] of this.tabs) {
      if (entry.tmuxSession === tmuxSession) return tabId;
    }
    return undefined;
  }

  updateTabFromHook(tmuxSession: string, event: string, notificationType?: string): void {
    const tabId = this.findTabIdBySession(tmuxSession);
    if (!tabId) {
      hookLog.debug({ tmuxSession, event, notificationType }, 'no tabId for session');
      return;
    }
    const entry = this.tabs.get(tabId);
    if (!entry) {
      hookLog.debug({ tabId, event, notificationType }, 'no entry for tab');
      return;
    }

    if (event === 'pre-compact' || event === 'post-compact') {
      hookLog.debug({ tabId, event }, 'compact hook');
      this.setCompacting(tabId, entry, event === 'pre-compact' ? Date.now() : null);
      return;
    }

    if (event !== 'session-start' && event !== 'prompt-submit' && event !== 'notification' && event !== 'stop' && event !== 'interrupt') {
      hookLog.debug({ tabId, event, notificationType }, 'unknown event, ignoring');
      return;
    }
    const eventName = event as TEventName;
    const provider = getProviderByPanelType(entry.panelType);

    if (!shouldProcessHookEvent(eventName, notificationType)) {
      hookLog.debug({ tabId, event: eventName, notificationType }, 'non-input notification, skipping state transition');
      return;
    }

    const now = Date.now();
    const seq = (entry.eventSeq ?? 0) + 1;
    entry.eventSeq = seq;
    entry.lastEvent = { name: eventName, at: now, seq };
    this.broadcast({ type: 'status:hook-event', tabId, event: entry.lastEvent });

    const prevState = entry.cliState;
    const decision = reduceHookState({
      currentState: prevState,
      eventName,
      providerId: provider?.id ?? null,
    });

    if (decision.deferCodexStop) {
      hookLog.debug({ tabId, event: eventName, notificationType, seq, prevState }, 'queued Codex stop JSONL verification');
      this.recheckCodexStop(tabId, tmuxSession);
      return;
    }

    const newState = decision.nextState;

    hookLog.debug(
      { tabId, event: eventName, notificationType, seq, prevState, newState, transition: decision.changed },
      `processed ${eventName}${notificationType ? `(${notificationType})` : ''} ${prevState}→${newState}`,
    );

    if (decision.changed) {
      this.applyCliState(tabId, entry, newState);
      this.persistToLayout(entry);
      this.broadcastUpdate(tabId, entry);
    }

    if ((newState === 'busy' || newState === 'needs-input') && !entry.jsonlPath) {
      this.resolveAndWatchJsonl(tabId, tmuxSession).catch(() => {});
    }

    if (eventName === 'stop' && entry.jsonlPath) {
      const refreshSnippet = () => {
        const provider = getProviderByPanelType(entry.panelType);
        const check = provider
          ? checkProviderJsonlIdle(provider, entry.jsonlPath!)
          : checkJsonlIdle(entry.jsonlPath!);
        check.then(({ currentAction, lastAssistantSnippet, reset }) => {
          const { next, changed } = mergeStatusMetadata(entry, {
            currentAction,
            lastAssistantSnippet,
            reset,
          });
          if (changed) {
            entry.currentAction = next.currentAction;
            entry.lastAssistantMessage = next.lastAssistantMessage;
          }
          const updated = changed;
          if (updated) this.broadcastUpdate(tabId, entry);
        }).catch(() => {});
      };
      refreshSnippet();
      setTimeout(() => {
        jsonlIdleCache.delete(entry.jsonlPath!);
        refreshSnippet();
      }, 500);
    }
  }

  private recheckCodexStop(tabId: string, tmuxSession: string): void {
    setTimeout(() => {
      const refresh = async () => {
        let entry = this.tabs.get(tabId);
        if (!entry) return;

        if (!entry.jsonlPath) {
          await this.resolveAndWatchJsonl(tabId, tmuxSession);
          entry = this.tabs.get(tabId);
        }

        if (!entry?.jsonlPath) return;
        jsonlIdleCache.delete(entry.jsonlPath);
        await this.onJsonlFileChange(tabId, entry.jsonlPath);
      };

      refresh().catch((err) => {
        hookLog.warn('Codex stop JSONL verification failed: %s', err);
      });
    }, CODEX_STOP_RECHECK_MS);
  }

  private setCompacting(tabId: string, entry: ITabStatusEntry, since: number | null): void {
    const existingTimer = this.compactStaleTimers.get(tabId);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.compactStaleTimers.delete(tabId);
    }

    if ((entry.compactingSince ?? null) === since) return;
    entry.compactingSince = since;
    this.broadcastUpdate(tabId, entry);

    if (since !== null) {
      const timer = setTimeout(() => {
        this.compactStaleTimers.delete(tabId);
        const e = this.tabs.get(tabId);
        if (!e || e.compactingSince !== since) return;
        e.compactingSince = null;
        hookLog.debug({ tabId }, 'compact stale, auto-cleared');
        this.broadcastUpdate(tabId, e);
      }, COMPACT_STALE_MS);
      this.compactStaleTimers.set(tabId, timer);
    }
  }

  removeTab(tabId: string): boolean {
    const entry = this.tabs.get(tabId);
    if (!entry) return false;
    if (entry && (entry.cliState === 'busy' || entry.cliState === 'needs-input') && entry.lastUserMessage) {
      this.saveSessionHistory(tabId, entry, entry.busySince, true).catch((err) => {
        log.warn('Failed to save cancelled session history: %s', err);
      });
    }
    this.stopJsonlWatch(tabId);
    const compactTimer = this.compactStaleTimers.get(tabId);
    if (compactTimer) {
      clearTimeout(compactTimer);
      this.compactStaleTimers.delete(tabId);
    }
    this.tabs.delete(tabId);
    this.broadcastRemove(tabId);
    return true;
  }

  reconcileWorkspaceTabs(wsId: string, validTabIds: readonly string[]): void {
    const valid = new Set(validTabIds);
    for (const [tabId, entry] of this.tabs) {
      if (entry.workspaceId === wsId && !valid.has(tabId)) {
        this.removeTab(tabId);
      }
    }
  }

  removeWorkspaceTabs(wsId: string): void {
    for (const [tabId, entry] of this.tabs) {
      if (entry.workspaceId === wsId) {
        this.removeTab(tabId);
      }
    }
  }

  registerTab(tabId: string, entry: ITabStatusEntry): void {
    this.tabs.set(tabId, entry);
    this.broadcastUpdate(tabId, entry);
  }

  addClient(ws: WebSocket): void {
    this.clients.add(ws);
    if (this.lastRateLimits && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'rate-limits:update', data: this.lastRateLimits }));
    }
  }

  removeClient(ws: WebSocket): void {
    this.clients.delete(ws);
  }

  private persistToLayout(entry: ITabStatusEntry): void {
    Promise.resolve(
      this.options.persistTabCliStatus
        ? this.options.persistTabCliStatus(entry)
        : updateTabCliStatus(entry.tmuxSession, entry.cliState, entry.dismissedAt),
    ).catch(() => {});
  }

  private broadcastUpdate(tabId: string, entry: ITabStatusEntry, exclude?: WebSocket): void {
    const msg: IStatusUpdateMessage = {
      type: 'status:update',
      tabId,
      cliState: entry.cliState,
      workspaceId: entry.workspaceId,
      tabName: entry.tabName,
      currentProcess: entry.currentProcess,
      paneTitle: entry.paneTitle,
      panelType: entry.panelType,
      terminalStatus: entry.terminalStatus,
      listeningPorts: entry.listeningPorts,
      agentSummary: entry.agentSummary,
      lastUserMessage: entry.lastUserMessage,
      lastAssistantMessage: entry.lastAssistantMessage,
      currentAction: entry.currentAction,
      readyForReviewAt: entry.readyForReviewAt,
      busySince: entry.busySince,
      dismissedAt: entry.dismissedAt,
      agentSessionId: entry.agentSessionId,
      compactingSince: entry.compactingSince,
      lastEvent: entry.lastEvent,
      eventSeq: entry.eventSeq,
      approvalPromptMetadata: entry.approvalPromptMetadata,
    };
    this.broadcast(msg, exclude);
    forwardBridgeTraceStatusUpdate(msg).catch((err) => {
      log.debug('bridge trace forward failed: %s', err instanceof Error ? err.message : String(err));
    });
  }

  private broadcastRemove(tabId: string): void {
    const msg: IStatusUpdateMessage = {
      type: 'status:update',
      tabId,
      cliState: null,
      workspaceId: '',
      tabName: '',
    };
    this.broadcast(msg);
  }

  private static readonly BACKPRESSURE_LIMIT = 1024 * 1024;

  broadcast(event: object, exclude?: WebSocket): void {
    if (this.options.broadcast) {
      this.options.broadcast(event, exclude);
      return;
    }
    const msg = JSON.stringify(event);
    let sent = 0;
    let skippedBackpressure = 0;
    for (const ws of this.clients) {
      if (ws === exclude || ws.readyState !== WebSocket.OPEN) continue;
      if (ws.bufferedAmount >= StatusManager.BACKPRESSURE_LIMIT) {
        skippedBackpressure++;
        continue;
      }
      ws.send(msg);
      sent++;
    }
    if (sent > 0) recordPerfCounter('status.ws.sent', sent);
    if (skippedBackpressure > 0) {
      recordPerfCounter('status.ws.backpressure_skipped', skippedBackpressure);
    }
  }

  private async resolveAndWatchJsonl(tabId: string, tmuxSession: string): Promise<void> {
    const entry = this.tabs.get(tabId);
    if (!entry || entry.jsonlPath) return;

    let jsonlPath: string | null = null;

    const parsed = parseSessionName(tmuxSession);
    if (parsed) {
      const layout = await readLayoutFile(resolveLayoutFile(parsed.wsId));
      if (layout) {
        const tab = collectAllTabs(layout.root).find((t) => t.sessionName === tmuxSession);
        const provider = getProviderByPanelType(entry.panelType);
        const tabAgentSessionId = tab ? normalizeSessionId(readAgentSessionId(tab)) : null;
        if (provider && tabAgentSessionId) {
          const cwd = await getSessionCwd(tmuxSession);
          if (cwd) {
            jsonlPath = await provider.resolveJsonlPath(tabAgentSessionId, cwd);
          }
        }

        if (tab?.lastUserMessage && entry.lastUserMessage !== tab.lastUserMessage) {
          entry.lastUserMessage = tab.lastUserMessage;
          this.broadcastUpdate(tabId, entry);
        }
      }
    }

    if (!jsonlPath) {
      const panePid = await getSessionPanePid(tmuxSession);
      if (panePid) {
        const { info } = await detectAnyActiveSession(panePid);
        jsonlPath = info.jsonlPath;
        if (info.sessionId) entry.agentSessionId = info.sessionId;
      }
    }

    if (!jsonlPath) return;

    entry.jsonlPath = jsonlPath;
    entry.agentSessionId = resolveAgentSessionId({
      currentSessionId: entry.agentSessionId,
      jsonlPath,
    });

    if ((entry.cliState === 'busy' || entry.cliState === 'needs-input') && !this.jsonlWatchers.has(tabId)) {
      this.startJsonlWatch(tabId, jsonlPath);
    }
    const provider = getProviderByPanelType(entry.panelType);
    if (provider?.id === 'codex') {
      this.startJsonlWatch(tabId, jsonlPath);
      const metadata = await checkProviderJsonlIdle(provider, jsonlPath);
      this.mergeJsonlMetadata(entry, metadata);
      this.reconcileCodexState(tabId, entry, { ...metadata, jsonlPath, running: true });
      this.broadcastUpdate(tabId, entry);
    }
  }

  private startJsonlWatch(tabId: string, jsonlPath: string): void {
    const existing = this.jsonlWatchers.get(tabId);
    if (existing?.jsonlPath === jsonlPath) return;
    if (existing) this.stopJsonlWatch(tabId);

    log.debug('startJsonlWatch tabId=%s path=%s', tabId, jsonlPath);
    try {
      const watcher = watch(jsonlPath, () => {
        const w = this.jsonlWatchers.get(tabId);
        if (!w) return;
        if (w.debounceTimer) clearTimeout(w.debounceTimer);
        w.debounceTimer = setTimeout(() => {
          this.onJsonlFileChange(tabId, jsonlPath).catch(() => {});
        }, JSONL_WATCH_DEBOUNCE_MS);
      });
      watcher.on('error', () => {
        this.stopJsonlWatch(tabId);
      });
      this.jsonlWatchers.set(tabId, { watcher, jsonlPath, debounceTimer: null });
    } catch {
      // file may not exist yet
    }
  }

  private stopJsonlWatch(tabId: string): void {
    const w = this.jsonlWatchers.get(tabId);
    if (!w) return;
    log.debug('stopJsonlWatch tabId=%s', tabId);
    if (w.debounceTimer) clearTimeout(w.debounceTimer);
    try { w.watcher.close(); } catch { /* noop */ }
    this.jsonlWatchers.delete(tabId);
  }

  private async onJsonlFileChange(tabId: string, jsonlPath: string): Promise<void> {
    const entry = this.tabs.get(tabId);
    if (!entry) {
      this.stopJsonlWatch(tabId);
      return;
    }
    const provider = getProviderByPanelType(entry.panelType);
    const isCodex = provider?.id === 'codex';
    const isActive = entry.cliState === 'busy' || entry.cliState === 'needs-input' || entry.cliState === 'unknown' || isCodex;
    if (!isActive && entry.cliState !== 'ready-for-review') {
      this.stopJsonlWatch(tabId);
      return;
    }

    const check = provider
      ? await checkProviderJsonlIdle(provider, jsonlPath)
      : await checkJsonlIdle(jsonlPath);
    const { interrupted, lastEntryTs } = check;

    if (
      interrupted
      && entry.cliState === 'busy'
      && lastEntryTs !== null
      && lastEntryTs > (entry.lastInterruptTs ?? 0)
      && lastEntryTs > (entry.lastEvent?.at ?? 0)
    ) {
      entry.lastInterruptTs = lastEntryTs;
      hookLog.debug({ tabId, lastEntryTs }, 'synthetic interrupt from JSONL');
      this.updateTabFromHook(entry.tmuxSession, 'interrupt');
    }

    let changed = false;

    changed = this.mergeJsonlMetadata(entry, check) || changed;

    if (isCodex) {
      entry.jsonlPath = jsonlPath;
      changed = this.reconcileCodexState(tabId, entry, { ...check, jsonlPath, running: true }) || changed;
      const recovery = await this.recoverPendingInputFromPane(tabId);
      if (recovery.recovered) {
        changed = false;
      } else {
        const interruptedRecovery = await this.recoverInterruptedPromptFromPane(tabId);
        if (interruptedRecovery.recovered) {
          changed = false;
        } else if (entry.cliState === 'busy' && check.currentAction?.toolName) {
          setTimeout(() => {
            this.recoverPendingInputFromPane(tabId).catch((err) => {
              hookLog.debug({ tabId, err }, 'delayed permission prompt recovery failed');
            });
          }, 750);
        }
      }
    }

    if (changed) {
      this.broadcastUpdate(tabId, entry);
    }
  }

  shutdown(): void {
    this.stopPolling();
    this.rateLimitsWatcher?.stop();
    for (const tabId of [...this.jsonlWatchers.keys()]) {
      this.stopJsonlWatch(tabId);
    }
    for (const ws of this.clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close(1001, 'Server shutting down');
      }
    }
    this.clients.clear();
  }

  notifyLastUserMessage(sessionName: string, message: string): boolean {
    const parsed = parseSessionName(sessionName);
    if (!parsed) return false;
    const entry = this.tabs.get(parsed.tabId);
    if (!entry || entry.lastUserMessage === message) return false;
    entry.lastUserMessage = message;
    this.broadcastUpdate(parsed.tabId, entry);
    return true;
  }

  private async sendWebPush(tabId: string, entry: ITabStatusEntry, pushType: 'review' | 'needs-input'): Promise<void> {
    const ws = (await getWorkspaces()).workspaces.find((w) => w.id === entry.workspaceId);
    const config = await getConfig();
    await this.webPushAdapter.send({
      tabId,
      entry,
      pushType,
      workspaceName: ws?.name ?? '',
      workspaceDir: ws?.directories[0] ?? null,
      soundOnCompleteEnabled: config.soundOnCompleteEnabled !== false,
      anyDeviceVisible: isAnyDeviceVisible(),
    });
  }
}

export const getStatusManager = (): StatusManager => {
  if (!g.__ptStatusManager) {
    const manager = new StatusManager();
    g.__ptStatusManager = manager;
    setLayoutReconciler({
      reconcileWorkspaceTabs: (wsId, validTabIds) => manager.reconcileWorkspaceTabs(wsId, validTabIds),
      removeWorkspaceTabs: (wsId) => manager.removeWorkspaceTabs(wsId),
    });
  }
  return g.__ptStatusManager;
};
