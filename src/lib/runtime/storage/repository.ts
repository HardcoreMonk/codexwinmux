import type {
  IRuntimeCreateWorkspaceResult,
  IRuntimeDeleteTerminalTabStorageResult,
  IRuntimeDeleteWorkspaceStorageResult,
  IRuntimeEnsureWorkspacePaneResult,
  IRuntimePendingTerminalTab,
  IRuntimeTabStatusMetadata,
  IRuntimeTabStatusMetadataPatchInput,
  IRuntimeTabStatusMetadataResult,
  IRuntimeTerminalTab,
  IRuntimeWorkspace,
  IRuntimeWorkspaceTerminalSession,
  TRuntimeLayout,
} from '@/lib/runtime/contracts';
import { createRuntimeId } from '@/lib/runtime/session-name';
import type { TRuntimeDatabase } from '@/lib/runtime/storage/schema';
import type { IHistoryEntry } from '@/types/message-history';
import type {
  ILayoutData,
  IPaneNode,
  ISplitNode,
  ITab,
  IWorkspace,
  IWorkspaceGroup,
  IWorkspacesData,
  TLayoutNode,
  TRuntimeVersion,
} from '@/types/terminal';
import { equalizeNode } from '@/lib/layout-tree';

export interface ICreateWorkspaceInput {
  name: string;
  defaultCwd: string;
}

export interface IRenameWorkspaceInput {
  workspaceId: string;
  name: string;
}

export interface ICreateWorkspaceGroupInput {
  name: string;
}

export interface IRenameWorkspaceGroupInput {
  groupId: string;
  name: string;
}

export interface ISetWorkspaceGroupCollapsedInput {
  groupId: string;
  collapsed: boolean;
}

export interface IDeleteWorkspaceGroupInput {
  groupId: string;
}

export interface ISetWorkspaceGroupInput {
  workspaceId: string;
  groupId: string | null;
}

export interface IReorderWorkspaceItem {
  id: string;
  groupId?: string | null;
}

export interface IReorderWorkspacesInput {
  items: IReorderWorkspaceItem[];
}

export interface IReorderWorkspaceGroupsInput {
  groupIds: string[];
}

export interface IRuntimeLayoutTabInput {
  id: string;
  sessionName: string;
  name?: string;
  title?: string | null;
  cwd?: string | null;
  panelType?: ITab['panelType'];
  webUrl?: string | null;
  lastCommand?: string | null;
  terminalRatio?: number | null;
  terminalCollapsed?: boolean;
}

export interface ISplitPaneInput {
  workspaceId: string;
  sourcePaneId: string;
  newPaneId: string;
  orientation: 'horizontal' | 'vertical';
  tab: IRuntimeLayoutTabInput;
}

export interface IClosePaneInput {
  workspaceId: string;
  paneId: string;
}

export interface IClosePaneResult {
  layout: TRuntimeLayout;
  sessions: IRuntimeWorkspaceTerminalSession[];
}

export interface IPatchLayoutInput {
  workspaceId: string;
  activePaneId?: string;
  ratioUpdate?: { path: number[]; ratio: number };
  equalize?: boolean;
}

export interface IPatchPaneInput {
  workspaceId: string;
  paneId: string;
  activeTabId?: string;
}

export interface IReorderTabsInput {
  workspaceId: string;
  paneId: string;
  tabIds: string[];
}

export interface IMoveTabInput {
  workspaceId: string;
  tabId: string;
  fromPaneId: string;
  toPaneId: string;
  toIndex: number;
}

export interface IPatchTabInput {
  workspaceId: string;
  paneId: string;
  tabId: string;
  patch: Partial<Pick<ITab, 'name' | 'panelType' | 'terminalRatio' | 'terminalCollapsed'>> & {
    title?: string | null;
    cwd?: string | null;
    lastCommand?: string | null;
    webUrl?: string | null;
  };
}

export interface IEnsureWorkspacePaneInput {
  workspaceId: string;
  paneId: string;
  name: string;
  defaultCwd: string;
}

export interface ICreateTerminalTabInput {
  id: string;
  workspaceId: string;
  paneId: string;
  sessionName: string;
  cwd: string;
}

export interface IFinalizeTerminalTabInput {
  id: string;
}

export interface IFailPendingTerminalTabInput {
  id: string;
  reason: string;
}

export interface IFailReadyTerminalTabInput {
  id: string;
  reason: string;
}

export interface IDeleteWorkspaceInput {
  workspaceId: string;
}

export interface IDeleteTerminalTabInput {
  id: string;
}

export interface IMutationEventRow {
  id: string;
  entityType: string;
  entityId: string;
  eventType: string;
}

interface ITabRow {
  id: string;
  sessionName: string;
  name: string;
  order: number;
  title: string | null;
  cwd: string | null;
  panelType: string;
  runtimeVersion: TRuntimeVersion;
  lifecycleState: string;
  webUrl: string | null;
  lastCommand: string | null;
  terminalRatio: number | null;
  terminalCollapsed: number;
  cliState: ITab['cliState'] | null;
  agentSessionId: string | null;
  agentJsonlPath: string | null;
  agentSummary: string | null;
  lastUserMessage: string | null;
  dismissedAt: number | null;
}

interface IPaneRow {
  id: string;
  workspaceId?: string;
  parentId: string | null;
  nodeKind: 'pane' | 'split';
  splitAxis: 'horizontal' | 'vertical' | null;
  ratio: number | null;
  position: number;
  activeTabId: string | null;
}

interface IWorkspaceUiState {
  activeWorkspaceId?: string | null;
  sidebarCollapsed?: boolean;
  sidebarWidth?: number;
  updatedAt?: string;
}

const nowIso = (): string => new Date().toISOString();
const wsId = (): string => createRuntimeId('ws');
const paneId = (): string => createRuntimeId('pane');
const eventId = (): string => createRuntimeId('evt');
const workspaceGroupId = (): string => createRuntimeId('grp');

const pendingTabNotFoundError = (id: string): Error =>
  Object.assign(new Error(`pending terminal tab not found: ${id}`), {
    code: 'runtime-v2-pending-tab-not-found',
    retryable: false,
  });

const readyTabNotFoundError = (id: string): Error =>
  Object.assign(new Error(`ready terminal tab not found: ${id}`), {
    code: 'runtime-v2-ready-tab-not-found',
    retryable: false,
  });

export const createStorageRepository = (db: TRuntimeDatabase) => {
  const appendMutationEvent = db.prepare(`
    insert into mutation_events (id, command_id, actor, entity_type, entity_id, event_type, payload_json, created_at)
    values (@id, @commandId, @actor, @entityType, @entityId, @eventType, @payloadJson, @createdAt)
  `);

  const recordEvent = (entityType: string, entityId: string, eventType: string, payload: unknown): void => {
    appendMutationEvent.run({
      id: eventId(),
      commandId: null,
      actor: 'runtime-v2',
      entityType,
      entityId,
      eventType,
      payloadJson: JSON.stringify(payload),
      createdAt: nowIso(),
    });
  };

  const setAppState = (key: string, value: unknown, updatedAt = nowIso()): void => {
    db.prepare(`
      insert into app_state (key, value_json, updated_at)
      values (?, ?, ?)
      on conflict(key) do update set
        value_json = excluded.value_json,
        updated_at = excluded.updated_at
    `).run(key, JSON.stringify(value), updatedAt);
  };

  const readAppState = <T>(key: string): T | null => {
    const row = db.prepare(`select value_json as valueJson from app_state where key = ?`)
      .get(key) as { valueJson: string } | undefined;
    if (!row) return null;
    try {
      return JSON.parse(row.valueJson) as T;
    } catch {
      return null;
    }
  };

  const replaceWorkspaceDirectories = (workspaceId: string, directories: readonly string[], ts = nowIso()): void => {
    db.prepare(`delete from workspace_directories where workspace_id = ?`).run(workspaceId);
    const uniqueDirectories = [...new Set(directories.filter(Boolean))];
    uniqueDirectories.forEach((directory, index) => {
      db.prepare(`
        insert into workspace_directories (workspace_id, path, order_index, created_at, updated_at)
        values (?, ?, ?, ?, ?)
      `).run(workspaceId, directory, index, ts, ts);
    });
  };

  const listMessageHistory = (workspaceId: string): IHistoryEntry[] =>
    db.prepare(`
      select id, message, sent_at as sentAt
      from message_history
      where workspace_id = ?
      order by order_index asc, created_at asc, id asc
    `).all(workspaceId) as IHistoryEntry[];

  const replaceMessageHistoryTx = db.transaction((
    workspaceId: string,
    entries: readonly IHistoryEntry[],
    ts = nowIso(),
  ): void => {
    db.prepare(`delete from message_history where workspace_id = ?`).run(workspaceId);
    entries.forEach((entry, index) => {
      if (!entry.id || !entry.message || !entry.sentAt) return;
      db.prepare(`
        insert into message_history (workspace_id, id, message, sent_at, order_index, created_at, updated_at)
        values (?, ?, ?, ?, ?, ?, ?)
        on conflict(workspace_id, id) do update set
          message = excluded.message,
          sent_at = excluded.sent_at,
          order_index = excluded.order_index,
          updated_at = excluded.updated_at
      `).run(workspaceId, entry.id, entry.message, entry.sentAt, index, ts, ts);
    });
  });

  const readTabStatusMetadataBySession = (sessionName: string): IRuntimeTabStatusMetadata | null => {
    const row = db.prepare(`
      select
        t.workspace_id as workspaceId,
        t.id as tabId,
        s.agent_session_id as agentSessionId,
        s.agent_jsonl_ref as agentJsonlPath,
        s.agent_summary as agentSummary,
        s.last_user_message as lastUserMessage,
        s.cli_state as cliState,
        s.dismissed_at as dismissedAt
      from tabs t
      left join tab_status s on s.tab_id = t.id
      where t.session_name = ?
      limit 1
    `).get(sessionName) as IRuntimeTabStatusMetadata | undefined;
    return row ?? null;
  };

  const patchTabStatusMetadataTx = db.transaction((
    input: IRuntimeTabStatusMetadataPatchInput,
    ts = nowIso(),
  ): IRuntimeTabStatusMetadataResult => {
    const tab = db.prepare(`
      select
        t.id,
        t.workspace_id as workspaceId,
        t.cwd,
        s.agent_session_id as agentSessionId
      from tabs t
      left join tab_status s on s.tab_id = t.id
      where t.session_name = ?
      limit 1
    `).get(input.sessionName) as { id: string; workspaceId: string; cwd: string | null; agentSessionId: string | null } | undefined;
    if (!tab) return { updated: false, workspaceId: null, tabId: null };

    const nextAgentSessionId = input.agentSessionId !== undefined ? input.agentSessionId : tab.agentSessionId;
    if (nextAgentSessionId) {
      db.prepare(`
        insert into agent_sessions (
          id, provider, source, source_id, cwd, jsonl_ref, summary, created_at, updated_at
        )
        values (?, 'codex', 'tab-status-metadata', ?, ?, ?, ?, ?, ?)
        on conflict(id) do update set
          cwd = coalesce(excluded.cwd, agent_sessions.cwd),
          jsonl_ref = coalesce(excluded.jsonl_ref, agent_sessions.jsonl_ref),
          summary = coalesce(excluded.summary, agent_sessions.summary),
          updated_at = excluded.updated_at
      `).run(
        nextAgentSessionId,
        nextAgentSessionId,
        tab.cwd,
        input.agentJsonlPath ?? null,
        input.agentSummary ?? null,
        ts,
        ts,
      );
    }

    db.prepare(`
      insert or ignore into tab_status (tab_id, cli_state, updated_at)
      values (?, 'inactive', ?)
    `).run(tab.id, ts);

    const assignments: string[] = [];
    const values: unknown[] = [];
    const assign = (column: string, value: unknown): void => {
      assignments.push(`${column} = ?`);
      values.push(value);
    };

    if (input.agentSessionId !== undefined) assign('agent_session_id', input.agentSessionId);
    if (input.agentJsonlPath !== undefined) assign('agent_jsonl_ref', input.agentJsonlPath);
    if (input.agentSummary !== undefined) assign('agent_summary', input.agentSummary);
    if (input.lastUserMessage !== undefined) assign('last_user_message', input.lastUserMessage);
    if (input.cliState !== undefined) assign('cli_state', input.cliState);
    if (input.dismissedAt !== undefined) assign('dismissed_at', input.dismissedAt);

    if (assignments.length > 0) {
      assignments.push('updated_at = ?');
      values.push(ts, tab.id);
      db.prepare(`
        update tab_status
        set ${assignments.join(', ')}
        where tab_id = ?
      `).run(...values);
    }

    touchWorkspace(tab.workspaceId, ts);
    return { updated: true, workspaceId: tab.workspaceId, tabId: tab.id };
  });

  const readWorkspaceById = (workspaceId: string): IRuntimeWorkspace | null => {
    const row = db.prepare(`
      select id, name, default_cwd as defaultCwd, active, group_id as groupId, order_index as orderIndex, created_at as createdAt, updated_at as updatedAt
      from workspaces
      where id = ?
    `).get(workspaceId) as IRuntimeWorkspace | undefined;
    return row ?? null;
  };

  const readWorkspaceGroupById = (groupId: string): IWorkspaceGroup | null => {
    const row = db.prepare(`
      select id, name, collapsed
      from workspace_groups
      where id = ?
    `).get(groupId) as { id: string; name: string; collapsed: number } | undefined;
    return row ? { id: row.id, name: row.name, collapsed: Boolean(row.collapsed) } : null;
  };

  const readPaneRow = (paneId: string): (IPaneRow & { workspaceId: string }) | null => {
    const row = db.prepare(`
      select id, workspace_id as workspaceId, parent_id as parentId, node_kind as nodeKind,
        split_axis as splitAxis, ratio, position, active_tab_id as activeTabId
      from panes
      where id = ?
    `).get(paneId) as (IPaneRow & { workspaceId: string }) | undefined;
    return row ?? null;
  };

  const readRootPaneRow = (workspaceId: string): (IPaneRow & { workspaceId: string }) | null => {
    const row = db.prepare(`
      select id, workspace_id as workspaceId, parent_id as parentId, node_kind as nodeKind,
        split_axis as splitAxis, ratio, position, active_tab_id as activeTabId
      from panes
      where workspace_id = ? and parent_id is null
      order by position asc, created_at asc, id asc
      limit 1
    `).get(workspaceId) as (IPaneRow & { workspaceId: string }) | undefined;
    return row ?? null;
  };

  const readChildPaneRows = (parentId: string): Array<IPaneRow & { workspaceId: string }> =>
    db.prepare(`
      select id, workspace_id as workspaceId, parent_id as parentId, node_kind as nodeKind,
        split_axis as splitAxis, ratio, position, active_tab_id as activeTabId
      from panes
      where parent_id = ?
      order by position asc, created_at asc, id asc
    `).all(parentId) as Array<IPaneRow & { workspaceId: string }>;

  const firstLeafPaneId = (rowId: string): string | null => {
    const row = readPaneRow(rowId);
    if (!row) return null;
    if (row.nodeKind === 'pane') return row.id;
    const firstChild = readChildPaneRows(row.id)[0];
    return firstChild ? firstLeafPaneId(firstChild.id) : null;
  };

  const touchWorkspace = (workspaceId: string, ts = nowIso(), activePaneId?: string | null): void => {
    if (activePaneId !== undefined) {
      db.prepare(`update workspaces set active_pane_id = ?, updated_at = ? where id = ?`)
        .run(activePaneId, ts, workspaceId);
      return;
    }
    db.prepare(`update workspaces set updated_at = ? where id = ?`).run(ts, workspaceId);
  };

  const insertReadyTab = (
    workspaceId: string,
    paneId: string,
    tab: IRuntimeLayoutTabInput,
    order: number,
    ts = nowIso(),
  ): void => {
    db.prepare(`
      insert into tabs (
        id, workspace_id, pane_id, session_name, panel_type, name, title, cwd,
        lifecycle_state, order_index, runtime_version, web_url, last_command,
        terminal_ratio, terminal_collapsed, created_at, updated_at
      )
      values (?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?, 2, ?, ?, ?, ?, ?, ?)
    `).run(
      tab.id,
      workspaceId,
      paneId,
      tab.sessionName,
      tab.panelType ?? 'terminal',
      tab.name ?? '',
      tab.title ?? null,
      tab.cwd ?? null,
      order,
      tab.webUrl ?? null,
      tab.lastCommand ?? null,
      tab.terminalRatio ?? null,
      tab.terminalCollapsed ? 1 : 0,
      ts,
      ts,
    );
    if ((tab.panelType ?? 'terminal') === 'terminal') {
      db.prepare(`insert or ignore into tab_status (tab_id, cli_state, updated_at) values (?, 'inactive', ?)`)
        .run(tab.id, ts);
    }
  };

  const reorderTabsInPane = (paneId: string, ts = nowIso()): void => {
    const tabs = db.prepare(`
      select id
      from tabs
      where pane_id = ?
      order by order_index asc, created_at asc, id asc
    `).all(paneId) as Array<{ id: string }>;
    tabs.forEach((tab, index) => {
      db.prepare(`update tabs set order_index = ?, updated_at = ? where id = ?`)
        .run(index, ts, tab.id);
    });
  };

  const setPaneActiveToFirstReady = (paneId: string, ts = nowIso()): void => {
    const active = db.prepare(`
      select id
      from tabs
      where pane_id = ? and lifecycle_state = 'ready'
      order by order_index asc, created_at asc, id asc
      limit 1
    `).get(paneId) as { id: string } | undefined;
    db.prepare(`update panes set active_tab_id = ?, updated_at = ? where id = ?`)
      .run(active?.id ?? null, ts, paneId);
  };

  const findSplitByPath = (workspaceId: string, path: readonly number[]): (IPaneRow & { workspaceId: string }) | null => {
    let row = readRootPaneRow(workspaceId);
    for (const index of path) {
      if (!row || row.nodeKind !== 'split') return null;
      row = readChildPaneRows(row.id)[index] ?? null;
    }
    return row?.nodeKind === 'split' ? row : null;
  };

  const applySplitRatios = (rowId: string, node: TLayoutNode, ts = nowIso()): void => {
    const row = readPaneRow(rowId);
    if (!row || row.nodeKind !== 'split' || node.type !== 'split') return;
    db.prepare(`update panes set ratio = ?, updated_at = ? where id = ?`).run(node.ratio, ts, row.id);
    const children = readChildPaneRows(row.id);
    applySplitRatios(children[0]?.id ?? '', node.children[0], ts);
    applySplitRatios(children[1]?.id ?? '', node.children[1], ts);
  };

  const removePaneFromTree = (workspaceId: string, paneId: string, ts = nowIso()): boolean => {
    const pane = readPaneRow(paneId);
    if (!pane || pane.workspaceId !== workspaceId || pane.nodeKind !== 'pane') return false;
    const paneCount = (db.prepare(`
      select count(*) as count
      from panes
      where workspace_id = ? and node_kind = 'pane'
    `).get(workspaceId) as { count: number }).count;
    if (paneCount <= 1 || !pane.parentId) return false;

    const parent = readPaneRow(pane.parentId);
    if (!parent || parent.nodeKind !== 'split') return false;
    const sibling = readChildPaneRows(parent.id).find((child) => child.id !== pane.id);
    if (!sibling) return false;
    const nextActivePaneId = firstLeafPaneId(sibling.id);

    db.prepare(`update panes set parent_id = ?, position = ?, updated_at = ? where id = ?`)
      .run(parent.parentId, parent.position, ts, sibling.id);
    db.prepare(`delete from panes where id = ?`).run(pane.id);
    db.prepare(`delete from panes where id = ?`).run(parent.id);

    const workspace = readWorkspaceById(workspaceId);
    const currentActivePane = db.prepare(`select active_pane_id as activePaneId from workspaces where id = ?`)
      .get(workspaceId) as { activePaneId: string | null } | undefined;
    const shouldMoveActive = !currentActivePane?.activePaneId || currentActivePane.activePaneId === paneId;
    touchWorkspace(workspaceId, ts, shouldMoveActive ? nextActivePaneId : undefined);
    if (!workspace) return false;
    return true;
  };

  const createWorkspaceTx = db.transaction((input: ICreateWorkspaceInput): IRuntimeCreateWorkspaceResult => {
    const workspaceId = wsId();
    const rootPaneId = paneId();
    const ts = nowIso();

    db.prepare(`
      insert into workspaces (id, name, default_cwd, active, order_index, active_pane_id, created_at, updated_at)
      values (?, ?, ?, 1, 0, ?, ?, ?)
    `).run(workspaceId, input.name, input.defaultCwd, rootPaneId, ts, ts);
    replaceWorkspaceDirectories(workspaceId, [input.defaultCwd], ts);

    db.prepare(`
      insert into panes (id, workspace_id, node_kind, position, created_at, updated_at)
      values (?, ?, 'pane', 0, ?, ?)
    `).run(rootPaneId, workspaceId, ts, ts);

    recordEvent('workspace', workspaceId, 'workspace.created', input);
    return { id: workspaceId, rootPaneId };
  });

  const renameWorkspaceTx = db.transaction((input: IRenameWorkspaceInput): IRuntimeWorkspace | null => {
    const existing = readWorkspaceById(input.workspaceId);
    if (!existing) return null;
    const trimmed = input.name.trim();
    if (!trimmed) return existing;

    const ts = nowIso();
    db.prepare(`update workspaces set name = ?, updated_at = ? where id = ?`)
      .run(trimmed, ts, input.workspaceId);
    recordEvent('workspace', input.workspaceId, 'workspace.renamed', {
      workspaceId: input.workspaceId,
      name: trimmed,
    });
    return readWorkspaceById(input.workspaceId);
  });

  const createWorkspaceGroupTx = db.transaction((input: ICreateWorkspaceGroupInput): IWorkspaceGroup => {
    const id = workspaceGroupId();
    const ts = nowIso();
    const nextOrder = (db.prepare(`
      select coalesce(max(order_index), -1) + 1 as nextOrder
      from workspace_groups
    `).get() as { nextOrder: number }).nextOrder;
    const nextNameNumber = (db.prepare(`select count(*) + 1 as nextNameNumber from workspace_groups`)
      .get() as { nextNameNumber: number }).nextNameNumber;
    const name = input.name.trim() || `Group ${nextNameNumber}`;

    db.prepare(`
      insert into workspace_groups (id, name, collapsed, order_index, created_at, updated_at)
      values (?, ?, 0, ?, ?, ?)
    `).run(id, name, nextOrder, ts, ts);
    recordEvent('workspace-group', id, 'workspace-group.created', { name });
    return { id, name, collapsed: false };
  });

  const renameWorkspaceGroupTx = db.transaction((input: IRenameWorkspaceGroupInput): IWorkspaceGroup | null => {
    const existing = readWorkspaceGroupById(input.groupId);
    if (!existing) return null;
    const name = input.name.trim();
    if (!name) return existing;
    const ts = nowIso();

    db.prepare(`update workspace_groups set name = ?, updated_at = ? where id = ?`)
      .run(name, ts, input.groupId);
    recordEvent('workspace-group', input.groupId, 'workspace-group.renamed', { groupId: input.groupId, name });
    return readWorkspaceGroupById(input.groupId);
  });

  const setWorkspaceGroupCollapsedTx = db.transaction((input: ISetWorkspaceGroupCollapsedInput): boolean => {
    const existing = readWorkspaceGroupById(input.groupId);
    if (!existing) return false;
    const ts = nowIso();

    db.prepare(`update workspace_groups set collapsed = ?, updated_at = ? where id = ?`)
      .run(input.collapsed ? 1 : 0, ts, input.groupId);
    recordEvent('workspace-group', input.groupId, 'workspace-group.collapsed', {
      groupId: input.groupId,
      collapsed: input.collapsed,
    });
    return true;
  });

  const deleteWorkspaceGroupTx = db.transaction((input: IDeleteWorkspaceGroupInput): boolean => {
    const existing = readWorkspaceGroupById(input.groupId);
    if (!existing) return false;
    db.prepare(`delete from workspace_groups where id = ?`).run(input.groupId);
    recordEvent('workspace-group', input.groupId, 'workspace-group.deleted', { groupId: input.groupId });
    return true;
  });

  const reorderWorkspaceGroupsTx = db.transaction((input: IReorderWorkspaceGroupsInput): boolean => {
    const existingRows = db.prepare(`select id from workspace_groups order by order_index asc, created_at asc, id asc`)
      .all() as Array<{ id: string }>;
    const existingIds = existingRows.map((row) => row.id);
    const nextIds = input.groupIds;
    const uniqueNextIds = new Set(nextIds);
    if (nextIds.length !== existingIds.length || uniqueNextIds.size !== nextIds.length) return false;
    if (existingIds.some((id) => !uniqueNextIds.has(id))) return false;

    const ts = nowIso();
    nextIds.forEach((id, index) => {
      db.prepare(`update workspace_groups set order_index = ?, updated_at = ? where id = ?`)
        .run(index, ts, id);
    });
    recordEvent('workspace-group', 'all', 'workspace-group.reordered', { groupIds: nextIds });
    return true;
  });

  const setWorkspaceGroupTx = db.transaction((input: ISetWorkspaceGroupInput): boolean => {
    const workspace = readWorkspaceById(input.workspaceId);
    if (!workspace) return false;
    const nextGroupId = input.groupId && readWorkspaceGroupById(input.groupId) ? input.groupId : null;
    const ts = nowIso();

    db.prepare(`update workspaces set group_id = ?, updated_at = ? where id = ?`)
      .run(nextGroupId, ts, input.workspaceId);
    recordEvent('workspace', input.workspaceId, 'workspace.group-set', {
      workspaceId: input.workspaceId,
      groupId: nextGroupId,
    });
    return true;
  });

  const reorderWorkspacesTx = db.transaction((input: IReorderWorkspacesInput): boolean => {
    const existingRows = db.prepare(`select id from workspaces order by order_index asc, created_at asc, id asc`)
      .all() as Array<{ id: string }>;
    const existingIds = existingRows.map((row) => row.id);
    const nextIds = input.items.map((item) => item.id);
    const uniqueNextIds = new Set(nextIds);
    if (nextIds.length !== existingIds.length || uniqueNextIds.size !== nextIds.length) return false;
    if (existingIds.some((id) => !uniqueNextIds.has(id))) return false;

    const groupRows = db.prepare(`select id from workspace_groups`).all() as Array<{ id: string }>;
    const validGroupIds = new Set(groupRows.map((row) => row.id));
    const ts = nowIso();
    input.items.forEach((item, index) => {
      const hasGroupId = Object.prototype.hasOwnProperty.call(item, 'groupId');
      const nextGroupId = hasGroupId
        ? item.groupId && validGroupIds.has(item.groupId) ? item.groupId : null
        : undefined;
      if (hasGroupId) {
        db.prepare(`update workspaces set order_index = ?, group_id = ?, updated_at = ? where id = ?`)
          .run(index, nextGroupId, ts, item.id);
      } else {
        db.prepare(`update workspaces set order_index = ?, updated_at = ? where id = ?`)
          .run(index, ts, item.id);
      }
    });
    recordEvent('workspace', 'all', 'workspace.reordered', { items: input.items });
    return true;
  });

  const splitPaneTx = db.transaction((input: ISplitPaneInput): TRuntimeLayout => {
    const source = readPaneRow(input.sourcePaneId);
    if (!source || source.workspaceId !== input.workspaceId || source.nodeKind !== 'pane') return null;
    const ts = nowIso();
    const splitId = paneId();

    db.prepare(`
      insert into panes (id, workspace_id, parent_id, node_kind, split_axis, ratio, position, created_at, updated_at)
      values (?, ?, ?, 'split', ?, 50, ?, ?, ?)
    `).run(splitId, input.workspaceId, source.parentId, input.orientation, source.position, ts, ts);

    db.prepare(`update panes set parent_id = ?, position = 0, updated_at = ? where id = ?`)
      .run(splitId, ts, source.id);

    db.prepare(`
      insert into panes (id, workspace_id, parent_id, node_kind, position, active_tab_id, created_at, updated_at)
      values (?, ?, ?, 'pane', 1, null, ?, ?)
    `).run(input.newPaneId, input.workspaceId, splitId, ts, ts);
    insertReadyTab(input.workspaceId, input.newPaneId, input.tab, 0, ts);
    db.prepare(`update panes set active_tab_id = ?, updated_at = ? where id = ?`)
      .run(input.tab.id, ts, input.newPaneId);

    touchWorkspace(input.workspaceId, ts, input.newPaneId);
    recordEvent('layout', input.workspaceId, 'layout.pane-split', {
      workspaceId: input.workspaceId,
      sourcePaneId: input.sourcePaneId,
      newPaneId: input.newPaneId,
      orientation: input.orientation,
      tabId: input.tab.id,
    });
    return createStorageRepository(db).getWorkspaceLayout(input.workspaceId);
  });

  const closePaneTx = db.transaction((input: IClosePaneInput): IClosePaneResult | null => {
    const pane = readPaneRow(input.paneId);
    if (!pane || pane.workspaceId !== input.workspaceId || pane.nodeKind !== 'pane') return null;
    const sessions = db.prepare(`
      select session_name as sessionName
      from tabs
      where pane_id = ? and session_name is not null and panel_type <> 'web-browser'
      order by order_index asc, created_at asc, id asc
    `).all(input.paneId) as IRuntimeWorkspaceTerminalSession[];
    const ts = nowIso();
    if (!removePaneFromTree(input.workspaceId, input.paneId, ts)) return null;
    recordEvent('layout', input.workspaceId, 'layout.pane-closed', {
      workspaceId: input.workspaceId,
      paneId: input.paneId,
    });
    return {
      layout: createStorageRepository(db).getWorkspaceLayout(input.workspaceId),
      sessions,
    };
  });

  const patchLayoutTx = db.transaction((input: IPatchLayoutInput): TRuntimeLayout => {
    const workspace = readWorkspaceById(input.workspaceId);
    if (!workspace) return null;
    const ts = nowIso();

    if (input.activePaneId !== undefined) {
      const pane = readPaneRow(input.activePaneId);
      if (!pane || pane.workspaceId !== input.workspaceId || pane.nodeKind !== 'pane') return null;
      touchWorkspace(input.workspaceId, ts, input.activePaneId);
    }

    if (input.ratioUpdate) {
      const split = findSplitByPath(input.workspaceId, input.ratioUpdate.path);
      if (!split) return null;
      db.prepare(`update panes set ratio = ?, updated_at = ? where id = ?`)
        .run(input.ratioUpdate.ratio, ts, split.id);
      touchWorkspace(input.workspaceId, ts);
    }

    if (input.equalize) {
      const layout = createStorageRepository(db).getWorkspaceLayout(input.workspaceId);
      if (!layout) return null;
      const root = readRootPaneRow(input.workspaceId);
      if (!root) return null;
      applySplitRatios(root.id, equalizeNode(layout.root), ts);
      touchWorkspace(input.workspaceId, ts);
    }

    recordEvent('layout', input.workspaceId, 'layout.patched', input);
    return createStorageRepository(db).getWorkspaceLayout(input.workspaceId);
  });

  const patchPaneTx = db.transaction((input: IPatchPaneInput): TRuntimeLayout => {
    const pane = readPaneRow(input.paneId);
    if (!pane || pane.workspaceId !== input.workspaceId || pane.nodeKind !== 'pane') return null;
    const ts = nowIso();

    if (input.activeTabId !== undefined) {
      const tab = db.prepare(`select id from tabs where id = ? and pane_id = ?`)
        .get(input.activeTabId, input.paneId) as { id: string } | undefined;
      if (!tab) return null;
      db.prepare(`update panes set active_tab_id = ?, updated_at = ? where id = ?`)
        .run(input.activeTabId, ts, input.paneId);
    }

    touchWorkspace(input.workspaceId, ts);
    recordEvent('layout', input.workspaceId, 'layout.pane-patched', input);
    return createStorageRepository(db).getWorkspaceLayout(input.workspaceId);
  });

  const reorderTabsTx = db.transaction((input: IReorderTabsInput): TRuntimeLayout => {
    const pane = readPaneRow(input.paneId);
    if (!pane || pane.workspaceId !== input.workspaceId || pane.nodeKind !== 'pane') return null;
    const existing = db.prepare(`
      select id
      from tabs
      where pane_id = ?
      order by order_index asc, created_at asc, id asc
    `).all(input.paneId) as Array<{ id: string }>;
    const existingIds = existing.map((row) => row.id);
    const nextIds = input.tabIds;
    const uniqueNextIds = new Set(nextIds);
    if (nextIds.length !== existingIds.length || uniqueNextIds.size !== nextIds.length) return null;
    if (existingIds.some((id) => !uniqueNextIds.has(id))) return null;

    const ts = nowIso();
    nextIds.forEach((id, index) => {
      db.prepare(`update tabs set order_index = ?, updated_at = ? where id = ?`).run(index, ts, id);
    });
    touchWorkspace(input.workspaceId, ts);
    recordEvent('layout', input.workspaceId, 'layout.tabs-reordered', input);
    return createStorageRepository(db).getWorkspaceLayout(input.workspaceId);
  });

  const moveTabTx = db.transaction((input: IMoveTabInput): TRuntimeLayout => {
    const fromPane = readPaneRow(input.fromPaneId);
    const toPane = readPaneRow(input.toPaneId);
    if (!fromPane || !toPane || fromPane.workspaceId !== input.workspaceId || toPane.workspaceId !== input.workspaceId) return null;
    if (fromPane.nodeKind !== 'pane' || toPane.nodeKind !== 'pane') return null;

    const tab = db.prepare(`select id from tabs where id = ? and pane_id = ?`)
      .get(input.tabId, input.fromPaneId) as { id: string } | undefined;
    if (!tab) return null;

    const ts = nowIso();
    const targetRows = db.prepare(`
      select id
      from tabs
      where pane_id = ? and id <> ?
      order by order_index asc, created_at asc, id asc
    `).all(input.toPaneId, input.tabId) as Array<{ id: string }>;
    const targetIds = targetRows.map((row) => row.id);
    const boundedIndex = Math.max(0, Math.min(input.toIndex, targetIds.length));
    targetIds.splice(boundedIndex, 0, input.tabId);

    db.prepare(`update tabs set pane_id = ?, updated_at = ? where id = ?`)
      .run(input.toPaneId, ts, input.tabId);
    targetIds.forEach((id, index) => {
      db.prepare(`update tabs set order_index = ?, updated_at = ? where id = ?`).run(index, ts, id);
    });
    reorderTabsInPane(input.fromPaneId, ts);

    if (fromPane.activeTabId === input.tabId) setPaneActiveToFirstReady(input.fromPaneId, ts);
    db.prepare(`update panes set active_tab_id = ?, updated_at = ? where id = ?`)
      .run(input.tabId, ts, input.toPaneId);

    const remaining = (db.prepare(`select count(*) as count from tabs where pane_id = ?`)
      .get(input.fromPaneId) as { count: number }).count;
    if (remaining === 0) removePaneFromTree(input.workspaceId, input.fromPaneId, ts);
    touchWorkspace(input.workspaceId, ts, input.toPaneId);
    recordEvent('layout', input.workspaceId, 'layout.tab-moved', input);
    return createStorageRepository(db).getWorkspaceLayout(input.workspaceId);
  });

  const patchTabTx = db.transaction((input: IPatchTabInput): TRuntimeLayout => {
    const pane = readPaneRow(input.paneId);
    if (!pane || pane.workspaceId !== input.workspaceId || pane.nodeKind !== 'pane') return null;
    const tab = db.prepare(`select id from tabs where id = ? and pane_id = ?`)
      .get(input.tabId, input.paneId) as { id: string } | undefined;
    if (!tab) return null;

    const ts = nowIso();
    const patch = input.patch;
    const updates: string[] = [];
    const values: unknown[] = [];
    const add = (column: string, value: unknown): void => {
      updates.push(`${column} = ?`);
      values.push(value);
    };
    if (patch.name !== undefined) add('name', patch.name);
    if (patch.panelType !== undefined) add('panel_type', patch.panelType);
    if (patch.title !== undefined) add('title', patch.title);
    if (patch.cwd !== undefined) add('cwd', patch.cwd);
    if (patch.lastCommand !== undefined) add('last_command', patch.lastCommand);
    if (patch.webUrl !== undefined) add('web_url', patch.webUrl);
    if (patch.terminalRatio !== undefined) add('terminal_ratio', patch.terminalRatio);
    if (patch.terminalCollapsed !== undefined) add('terminal_collapsed', patch.terminalCollapsed ? 1 : 0);
    if (updates.length > 0) {
      updates.push('updated_at = ?');
      values.push(ts, input.tabId);
      db.prepare(`update tabs set ${updates.join(', ')} where id = ?`).run(...values);
    }

    touchWorkspace(input.workspaceId, ts);
    recordEvent('layout', input.workspaceId, 'layout.tab-patched', {
      workspaceId: input.workspaceId,
      paneId: input.paneId,
      tabId: input.tabId,
      fields: Object.keys(patch),
    });
    return createStorageRepository(db).getWorkspaceLayout(input.workspaceId);
  });

  const ensureWorkspacePaneTx = db.transaction((input: IEnsureWorkspacePaneInput): IRuntimeEnsureWorkspacePaneResult => {
    const ts = nowIso();
    const workspace = db.prepare(`select id from workspaces where id = ?`)
      .get(input.workspaceId) as { id: string } | undefined;
    if (!workspace) {
      const nextOrder = (db.prepare(`
        select coalesce(max(order_index), -1) + 1 as nextOrder
        from workspaces
      `).get() as { nextOrder: number }).nextOrder;
      db.prepare(`
        insert into workspaces (id, name, default_cwd, active, order_index, active_pane_id, created_at, updated_at)
        values (?, ?, ?, 0, ?, ?, ?, ?)
      `).run(input.workspaceId, input.name, input.defaultCwd, nextOrder, input.paneId, ts, ts);
      replaceWorkspaceDirectories(input.workspaceId, [input.defaultCwd], ts);
    }

    const pane = db.prepare(`
      select workspace_id as workspaceId
      from panes
      where id = ?
    `).get(input.paneId) as { workspaceId: string } | undefined;
    if (pane && pane.workspaceId !== input.workspaceId) {
      throw Object.assign(new Error(`runtime v2 pane does not belong to workspace: ${input.paneId}`), {
        code: 'runtime-v2-pane-workspace-mismatch',
        retryable: false,
      });
    }
    if (!pane) {
      db.prepare(`
        insert into panes (id, workspace_id, node_kind, position, created_at, updated_at)
        values (?, ?, 'pane', 0, ?, ?)
      `).run(input.paneId, input.workspaceId, ts, ts);
    }

    recordEvent('workspace', input.workspaceId, 'workspace.ensure-pane', input);
    return { workspaceId: input.workspaceId, paneId: input.paneId };
  });

  const createPendingTerminalTabTx = db.transaction((input: ICreateTerminalTabInput): IRuntimePendingTerminalTab => {
    const ts = nowIso();
    const pane = db.prepare(`
      select workspace_id as workspaceId
      from panes
      where id = ?
    `).get(input.paneId) as { workspaceId: string } | undefined;
    if (!pane) {
      throw Object.assign(new Error(`runtime v2 pane not found: ${input.paneId}`), {
        code: 'runtime-v2-pane-not-found',
        retryable: false,
      });
    }
    if (pane.workspaceId !== input.workspaceId) {
      throw Object.assign(new Error(`runtime v2 pane does not belong to workspace: ${input.paneId}`), {
        code: 'runtime-v2-pane-workspace-mismatch',
        retryable: false,
      });
    }
    const nextOrder = (db.prepare(`
      select coalesce(max(order_index), -1) + 1 as nextOrder
      from tabs
      where pane_id = ?
    `).get(input.paneId) as { nextOrder: number }).nextOrder;

    db.prepare(`
      insert into tabs (id, workspace_id, pane_id, session_name, panel_type, name, cwd, lifecycle_state, order_index, created_at, updated_at)
      values (?, ?, ?, ?, 'terminal', '', ?, 'pending_terminal', ?, ?, ?)
    `).run(input.id, input.workspaceId, input.paneId, input.sessionName, input.cwd, nextOrder, ts, ts);

    recordEvent('tab', input.id, 'tab.create-pending', input);
    return {
      id: input.id,
      sessionName: input.sessionName,
      workspaceId: input.workspaceId,
      paneId: input.paneId,
      cwd: input.cwd,
      runtimeVersion: 2,
      lifecycleState: 'pending_terminal',
      createdAt: ts,
    };
  });

  const finalizeTerminalTabTx = db.transaction((input: IFinalizeTerminalTabInput): IRuntimeTerminalTab => {
    const ts = nowIso();
    const row = db.prepare(`
      select id, workspace_id as workspaceId, pane_id as paneId, session_name as sessionName, cwd, order_index as "order"
      from tabs
      where id = ? and lifecycle_state = 'pending_terminal'
    `).get(input.id) as { id: string; workspaceId: string; paneId: string; sessionName: string; cwd: string | null; order: number } | undefined;
    if (!row) throw pendingTabNotFoundError(input.id);

    db.prepare(`update tabs set lifecycle_state = 'ready', updated_at = ? where id = ?`)
      .run(ts, input.id);

    db.prepare(`update panes set active_tab_id = ?, updated_at = ? where id = ?`)
      .run(input.id, ts, row.paneId);

    db.prepare(`insert into tab_status (tab_id, cli_state, updated_at) values (?, 'inactive', ?)`)
      .run(input.id, ts);

    recordEvent('tab', input.id, 'tab.created', row);
    return {
      id: input.id,
      sessionName: row.sessionName,
      name: '',
      order: row.order,
      ...(row.cwd ? { cwd: row.cwd } : {}),
      panelType: 'terminal',
      runtimeVersion: 2,
      lifecycleState: 'ready',
    };
  });

  const failPendingTerminalTabTx = db.transaction((input: IFailPendingTerminalTabInput): void => {
    const ts = nowIso();
    const result = db.prepare(`
      update tabs
      set lifecycle_state = 'failed', failure_reason = ?, updated_at = ?
      where id = ? and lifecycle_state = 'pending_terminal'
    `).run(input.reason, ts, input.id);
    if (result.changes !== 1) throw pendingTabNotFoundError(input.id);
    recordEvent('tab', input.id, 'tab.create-failed', input);
  });

  const failReadyTerminalTabTx = db.transaction((input: IFailReadyTerminalTabInput): void => {
    const ts = nowIso();
    const result = db.prepare(`
      update tabs
      set lifecycle_state = 'failed', failure_reason = ?, updated_at = ?
      where id = ? and lifecycle_state = 'ready'
    `).run(input.reason, ts, input.id);
    if (result.changes !== 1) throw readyTabNotFoundError(input.id);
    recordEvent('tab', input.id, 'tab.ready-reconciliation-failed', input);
  });

  const deleteWorkspaceTx = db.transaction((input: IDeleteWorkspaceInput): IRuntimeDeleteWorkspaceStorageResult => {
    const workspace = db.prepare(`select 1 as present from workspaces where id = ?`)
      .get(input.workspaceId) as { present: number } | undefined;
    if (!workspace) return { deleted: false, sessions: [] };

    const sessions = db.prepare(`
      select session_name as sessionName
      from tabs
      where workspace_id = ? and session_name is not null
        and runtime_version = 2
        and lifecycle_state in ('pending_terminal', 'ready')
      order by created_at asc, order_index asc, id asc
    `).all(input.workspaceId) as IRuntimeWorkspaceTerminalSession[];
    const result = db.prepare(`delete from workspaces where id = ?`).run(input.workspaceId);
    if (result.changes === 0) return { deleted: false, sessions: [] };
    recordEvent('workspace', input.workspaceId, 'workspace.deleted', input);
    return { deleted: true, sessions };
  });

  const deleteTerminalTabTx = db.transaction((input: IDeleteTerminalTabInput): IRuntimeDeleteTerminalTabStorageResult => {
    const ts = nowIso();
    const row = db.prepare(`
      select id, workspace_id as workspaceId, pane_id as paneId, session_name as sessionName, panel_type as panelType,
        runtime_version as runtimeVersion, lifecycle_state as lifecycleState
      from tabs
      where id = ?
    `).get(input.id) as {
      id: string;
      workspaceId: string;
      paneId: string;
      sessionName: string;
      panelType: string;
      runtimeVersion: TRuntimeVersion;
      lifecycleState: string;
    } | undefined;
    if (!row) return { deleted: false, session: null };

    db.prepare(`delete from tabs where id = ?`).run(input.id);

    const remaining = db.prepare(`
      select id
      from tabs
      where pane_id = ?
      order by order_index asc, created_at asc, id asc
    `).all(row.paneId) as Array<{ id: string }>;
    remaining.forEach((tab, index) => {
      db.prepare(`update tabs set order_index = ?, updated_at = ? where id = ?`)
        .run(index, ts, tab.id);
    });

    const active = db.prepare(`
      select id
      from tabs
      where pane_id = ? and lifecycle_state = 'ready'
      order by order_index asc, created_at asc, id asc
      limit 1
    `).get(row.paneId) as { id: string } | undefined;
    db.prepare(`update panes set active_tab_id = ?, updated_at = ? where id = ?`)
      .run(active?.id ?? null, ts, row.paneId);

    recordEvent('tab', input.id, 'tab.deleted', {
      id: input.id,
      sessionName: row.sessionName,
      lifecycleState: row.lifecycleState,
    });

    const shouldKill = row.panelType === 'terminal'
      && row.runtimeVersion === 2
      && ['pending_terminal', 'ready'].includes(row.lifecycleState);
    return {
      deleted: true,
      workspaceId: row.workspaceId,
      session: shouldKill ? { sessionName: row.sessionName } : null,
    };
  });

  return {
    createWorkspace: createWorkspaceTx,
    renameWorkspace: renameWorkspaceTx,
    createWorkspaceGroup: createWorkspaceGroupTx,
    renameWorkspaceGroup: renameWorkspaceGroupTx,
    setWorkspaceGroupCollapsed: setWorkspaceGroupCollapsedTx,
    deleteWorkspaceGroup: deleteWorkspaceGroupTx,
    reorderWorkspaceGroups: reorderWorkspaceGroupsTx,
    setWorkspaceGroup: setWorkspaceGroupTx,
    reorderWorkspaces: reorderWorkspacesTx,
    splitPane: splitPaneTx,
    closePane: closePaneTx,
    patchLayout: patchLayoutTx,
    patchPane: patchPaneTx,
    reorderTabs: reorderTabsTx,
    moveTab: moveTabTx,
    patchTab: patchTabTx,
    ensureWorkspacePane: ensureWorkspacePaneTx,
    createPendingTerminalTab: createPendingTerminalTabTx,
    finalizeTerminalTab: finalizeTerminalTabTx,
    failPendingTerminalTab: failPendingTerminalTabTx,
    failReadyTerminalTab: failReadyTerminalTabTx,
    deleteWorkspace: deleteWorkspaceTx,
    deleteTerminalTab: deleteTerminalTabTx,

    listPendingTerminalTabs(): IRuntimePendingTerminalTab[] {
      return db.prepare(`
        select id, session_name as sessionName, workspace_id as workspaceId, pane_id as paneId, cwd, lifecycle_state as lifecycleState, created_at as createdAt
        from tabs
        where lifecycle_state = 'pending_terminal'
        order by created_at asc, order_index asc, id asc
      `).all() as IRuntimePendingTerminalTab[];
    },

    listReadyTerminalTabs(): IRuntimeTerminalTab[] {
      const rows = db.prepare(`
        select id, session_name as sessionName, name, title, order_index as "order", cwd,
          panel_type as panelType, runtime_version as runtimeVersion, lifecycle_state as lifecycleState,
          web_url as webUrl, last_command as lastCommand, terminal_ratio as terminalRatio,
          terminal_collapsed as terminalCollapsed,
          null as cliState, null as agentSessionId, null as agentJsonlPath, null as agentSummary,
          null as lastUserMessage, null as dismissedAt
        from tabs
        where panel_type = 'terminal' and lifecycle_state = 'ready' and runtime_version = 2
        order by created_at asc, order_index asc, id asc
      `).all() as ITabRow[];
      return rows.map((row) => ({
        id: row.id,
        sessionName: row.sessionName,
        name: row.name,
        order: row.order,
        ...(row.cwd ? { cwd: row.cwd } : {}),
        panelType: 'terminal',
        runtimeVersion: 2,
        lifecycleState: 'ready',
      }));
    },

    getReadyTerminalTabBySession(sessionName: string): IRuntimeTerminalTab | null {
      const row = db.prepare(`
        select id, session_name as sessionName, name, title, order_index as "order", cwd,
          panel_type as panelType, runtime_version as runtimeVersion, lifecycle_state as lifecycleState,
          web_url as webUrl, last_command as lastCommand, terminal_ratio as terminalRatio,
          terminal_collapsed as terminalCollapsed,
          null as cliState, null as agentSessionId, null as agentJsonlPath, null as agentSummary,
          null as lastUserMessage, null as dismissedAt
        from tabs
        where session_name = ? and panel_type = 'terminal' and lifecycle_state = 'ready' and runtime_version = 2
      `).get(sessionName) as ITabRow | undefined;
      if (!row) return null;
      return {
        id: row.id,
        sessionName: row.sessionName,
        name: row.name,
        order: row.order,
        ...(row.cwd ? { cwd: row.cwd } : {}),
        panelType: 'terminal',
        runtimeVersion: 2,
        lifecycleState: 'ready',
      };
    },

    getWorkspaceLayout(workspaceId: string): TRuntimeLayout {
      const workspace = db.prepare(`
        select active_pane_id as activePaneId, updated_at as updatedAt
        from workspaces
        where id = ?
      `).get(workspaceId) as { activePaneId: string | null; updatedAt: string } | undefined;
      if (!workspace) return null;

      const panes = db.prepare(`
        select id, parent_id as parentId, node_kind as nodeKind, split_axis as splitAxis,
          ratio, position, active_tab_id as activeTabId
        from panes
        where workspace_id = ?
        order by parent_id asc, position asc, created_at asc, id asc
      `).all(workspaceId) as IPaneRow[];
      const rootPane = panes.find((pane) => pane.parentId === null);
      if (!rootPane) return null;

      const tabsByPaneId = new Map<string, ITab[]>();
      const tabRows = db.prepare(`
        select
          t.id,
          t.session_name as sessionName,
          t.name,
          t.title,
          t.order_index as "order",
          t.cwd,
          t.panel_type as panelType,
          t.runtime_version as runtimeVersion,
          t.lifecycle_state as lifecycleState,
          t.web_url as webUrl,
          t.last_command as lastCommand,
          t.terminal_ratio as terminalRatio,
          t.terminal_collapsed as terminalCollapsed,
          s.cli_state as cliState,
          s.agent_session_id as agentSessionId,
          s.agent_jsonl_ref as agentJsonlPath,
          s.agent_summary as agentSummary,
          s.last_user_message as lastUserMessage,
          s.dismissed_at as dismissedAt,
          t.pane_id as paneId
        from tabs t
        left join tab_status s on s.tab_id = t.id
        where t.workspace_id = ? and t.lifecycle_state = 'ready'
        order by t.pane_id asc, t.order_index asc, t.created_at asc, t.id asc
      `).all(workspaceId) as Array<ITabRow & { paneId: string }>;
      for (const row of tabRows) {
        const tab: ITab = {
          id: row.id,
          sessionName: row.sessionName,
          name: row.name,
          order: row.order,
          runtimeVersion: row.runtimeVersion,
          ...(row.title ? { title: row.title } : {}),
          ...(row.cwd ? { cwd: row.cwd } : {}),
          ...(row.panelType ? { panelType: row.panelType as ITab['panelType'] } : {}),
          ...(row.webUrl ? { webUrl: row.webUrl } : {}),
          ...(row.lastCommand ? { lastCommand: row.lastCommand } : {}),
          ...(row.terminalRatio !== null ? { terminalRatio: row.terminalRatio } : {}),
          ...(row.terminalCollapsed ? { terminalCollapsed: Boolean(row.terminalCollapsed) } : {}),
          ...(row.cliState ? { cliState: row.cliState } : {}),
          ...(row.agentSessionId ? { agentSessionId: row.agentSessionId } : {}),
          ...(row.agentJsonlPath ? { agentJsonlPath: row.agentJsonlPath } : {}),
          ...(row.agentSummary ? { agentSummary: row.agentSummary } : {}),
          ...(row.lastUserMessage ? { lastUserMessage: row.lastUserMessage } : {}),
          ...(row.dismissedAt !== null ? { dismissedAt: row.dismissedAt } : {}),
        };
        tabsByPaneId.set(row.paneId, [...(tabsByPaneId.get(row.paneId) ?? []), tab]);
      }

      const childrenByParentId = new Map<string, IPaneRow[]>();
      for (const pane of panes) {
        if (!pane.parentId) continue;
        childrenByParentId.set(pane.parentId, [...(childrenByParentId.get(pane.parentId) ?? []), pane]);
      }

      const buildNode = (row: IPaneRow): TLayoutNode => {
        if (row.nodeKind === 'pane') {
          return {
            type: 'pane',
            id: row.id,
            activeTabId: row.activeTabId,
            tabs: tabsByPaneId.get(row.id) ?? [],
          };
        }

        const children = (childrenByParentId.get(row.id) ?? []).sort((a, b) => a.position - b.position);
        const fallbackPane = (): IPaneNode => ({ type: 'pane', id: `${row.id}-missing`, activeTabId: null, tabs: [] });
        const left = children[0] ? buildNode(children[0]) : fallbackPane();
        const right = children[1] ? buildNode(children[1]) : fallbackPane();
        const split: ISplitNode = {
          type: 'split',
          orientation: row.splitAxis ?? 'horizontal',
          ratio: row.ratio ?? 50,
          children: [left, right],
        };
        return split;
      };

      const root = buildNode(rootPane);
      const layout: ILayoutData = {
        root,
        activePaneId: workspace.activePaneId,
        updatedAt: workspace.updatedAt,
      };
      return layout;
    },

    patchTabStatusMetadata(input: IRuntimeTabStatusMetadataPatchInput): IRuntimeTabStatusMetadataResult {
      return patchTabStatusMetadataTx(input);
    },

    getTabStatusMetadataBySession(sessionName: string): IRuntimeTabStatusMetadata | null {
      return readTabStatusMetadataBySession(sessionName);
    },

    setWorkspaceUiState(input: IWorkspaceUiState): void {
      const previous = readAppState<IWorkspaceUiState>('workspace-ui') ?? {};
      setAppState('workspace-ui', { ...previous, ...input, updatedAt: input.updatedAt ?? nowIso() }, input.updatedAt ?? nowIso());
    },

    replaceWorkspaceDirectories,
    listMessageHistory,
    replaceMessageHistory: replaceMessageHistoryTx,

    getWorkspaceSnapshot(): IWorkspacesData {
      const groupRows = db.prepare(`
        select id, name, collapsed
        from workspace_groups
        order by order_index asc, created_at asc, id asc
      `).all() as Array<{ id: string; name: string; collapsed: number }>;
      const groups: IWorkspaceGroup[] = groupRows.map((group) => ({
        id: group.id,
        name: group.name,
        collapsed: Boolean(group.collapsed),
      }));

      const workspaceRows = db.prepare(`
        select id, name, default_cwd as defaultCwd, active, group_id as groupId, updated_at as updatedAt
        from workspaces
        order by order_index asc, created_at asc, id asc
      `).all() as Array<{
        id: string;
        name: string;
        defaultCwd: string;
        active: number;
        groupId: string | null;
        updatedAt: string;
      }>;
      const directoriesByWorkspaceId = new Map<string, string[]>();
      const directoryRows = db.prepare(`
        select workspace_id as workspaceId, path
        from workspace_directories
        order by workspace_id asc, order_index asc
      `).all() as Array<{ workspaceId: string; path: string }>;
      for (const row of directoryRows) {
        directoriesByWorkspaceId.set(row.workspaceId, [...(directoriesByWorkspaceId.get(row.workspaceId) ?? []), row.path]);
      }

      const workspaces: IWorkspace[] = workspaceRows.map((workspace) => ({
        id: workspace.id,
        name: workspace.name,
        directories: directoriesByWorkspaceId.get(workspace.id) ?? [workspace.defaultCwd],
        ...(workspace.groupId ? { groupId: workspace.groupId } : {}),
      }));
      const validWorkspaceIds = new Set(workspaces.map((workspace) => workspace.id));
      const uiState = readAppState<IWorkspaceUiState>('workspace-ui') ?? {};
      const activeWorkspaceId = uiState.activeWorkspaceId && validWorkspaceIds.has(uiState.activeWorkspaceId)
        ? uiState.activeWorkspaceId
        : workspaceRows.find((workspace) => workspace.active)?.id ?? workspaces[0]?.id;
      const updatedAt = uiState.updatedAt
        ?? workspaceRows.reduce<string | null>((latest, workspace) => (
          !latest || workspace.updatedAt > latest ? workspace.updatedAt : latest
        ), null)
        ?? nowIso();

      return {
        workspaces,
        groups,
        ...(activeWorkspaceId ? { activeWorkspaceId } : {}),
        sidebarCollapsed: Boolean(uiState.sidebarCollapsed),
        sidebarWidth: typeof uiState.sidebarWidth === 'number' ? uiState.sidebarWidth : 240,
        updatedAt,
      };
    },

    listMutationEvents(): IMutationEventRow[] {
      return db.prepare(`
        select id, entity_type as entityType, entity_id as entityId, event_type as eventType
        from mutation_events
        order by created_at asc, id asc
      `).all() as IMutationEventRow[];
    },

    listWorkspaces(): IRuntimeWorkspace[] {
      return db.prepare(`
        select id, name, default_cwd as defaultCwd, active, group_id as groupId, order_index as orderIndex, created_at as createdAt, updated_at as updatedAt
        from workspaces
        order by order_index asc, created_at asc, id asc
      `).all() as IRuntimeWorkspace[];
    },

    hasWorkspace(workspaceId: string): boolean {
      const row = db.prepare(`select 1 as present from workspaces where id = ?`)
        .get(workspaceId) as { present: number } | undefined;
      return Boolean(row);
    },
  };
};
