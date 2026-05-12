import { getWorkspaces as loadWorkspaces } from '@/lib/workspace-store';
import type { IStatusUpdateMessage } from '@/types/status';
import type { IWorkspace, IWorkspaceGroup } from '@/types/terminal';

const MAX_FIELD_LENGTH = 700;

export interface IBridgeTracePayload {
  source: 'codexwinmux';
  event_id: string;
  event_type: 'status';
  project_dir: string;
  workspace_id: string;
  tab_id: string;
  tab_name: string;
  session_id: string | null;
  state: string;
  current_action: string | null;
  last_assistant_message: string | null;
  last_user_message: string | null;
  occurred_at: string;
}

export interface IBridgeTraceWorkspaceState {
  workspaces: IWorkspace[];
  groups: IWorkspaceGroup[];
  activeWorkspaceId?: string;
  sidebarCollapsed: boolean;
  sidebarWidth: number;
}

type TFetchImpl = (url: string, init: RequestInit) => Promise<{ ok: boolean; status: number }>;

interface IBridgeTraceForwarderOptions {
  url?: string;
  token?: string;
  fetchImpl?: TFetchImpl;
  now?: () => Date;
  getWorkspaces?: () => Promise<IBridgeTraceWorkspaceState>;
}

export interface IBridgeTraceForwarder {
  forwardStatusUpdate: (update: IStatusUpdateMessage) => Promise<void>;
}

const sanitizeField = (value: string | null | undefined): string | null => {
  const trimmed = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (!trimmed) return null;
  if (trimmed.length <= MAX_FIELD_LENGTH) return trimmed;
  return `${trimmed.slice(0, MAX_FIELD_LENGTH).trim()}...`;
};

const eventIdentity = (payload: IBridgeTracePayload): string => [
  payload.tab_id,
  payload.state,
  payload.session_id ?? '',
  payload.current_action ?? '',
  payload.last_assistant_message ?? '',
].join('|');

export const buildBridgeTracePayload = (
  update: IStatusUpdateMessage,
  workspaceState: IBridgeTraceWorkspaceState,
  occurredAt: Date = new Date(),
): IBridgeTracePayload | null => {
  if (!update.cliState) return null;
  const workspace = workspaceState.workspaces.find((candidate) => candidate.id === update.workspaceId);
  const projectDir = sanitizeField(workspace?.directories?.[0]);
  if (!projectDir) return null;

  const currentAction = sanitizeField(update.currentAction?.summary ?? null);
  const lastAssistantMessage = sanitizeField(update.lastAssistantMessage ?? null);
  const lastUserMessage = sanitizeField(update.lastUserMessage ?? null);
  const sessionId = sanitizeField(update.agentSessionId ?? null);
  const state = sanitizeField(update.cliState) ?? 'unknown';
  const tabName = sanitizeField(update.tabName) ?? update.tabId;
  const identity = [
    'status',
    update.tabId,
    state,
    sessionId ?? '',
    currentAction ?? '',
    lastAssistantMessage ?? '',
  ].join(':');

  return {
    source: 'codexwinmux',
    event_id: identity,
    event_type: 'status',
    project_dir: projectDir,
    workspace_id: update.workspaceId,
    tab_id: update.tabId,
    tab_name: tabName,
    session_id: sessionId,
    state,
    current_action: currentAction,
    last_assistant_message: lastAssistantMessage,
    last_user_message: lastUserMessage,
    occurred_at: occurredAt.toISOString(),
  };
};

export const createBridgeTraceForwarder = (
  options: IBridgeTraceForwarderOptions = {},
): IBridgeTraceForwarder => {
  const url = (options.url ?? process.env.CODEXMUX_BRIDGE_TRACE_URL ?? '').trim();
  const token = (options.token ?? process.env.CODEXMUX_BRIDGE_TRACE_TOKEN ?? '').trim();
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const now = options.now ?? (() => new Date());
  const getWorkspaces = options.getWorkspaces ?? loadWorkspaces;
  const lastByTab = new Map<string, string>();

  return {
    async forwardStatusUpdate(update: IStatusUpdateMessage): Promise<void> {
      if (!url || !token) return;
      const workspaceState = await getWorkspaces();
      const payload = buildBridgeTracePayload(update, workspaceState, now());
      if (!payload) return;

      const identity = eventIdentity(payload);
      if (lastByTab.get(payload.tab_id) === identity) return;
      lastByTab.set(payload.tab_id, identity);

      await fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      }).catch(() => undefined);
    },
  };
};

let defaultForwarder: IBridgeTraceForwarder | null = null;

export const forwardBridgeTraceStatusUpdate = async (update: IStatusUpdateMessage): Promise<void> => {
  if (!defaultForwarder) defaultForwarder = createBridgeTraceForwarder();
  await defaultForwarder.forwardStatusUpdate(update);
};
