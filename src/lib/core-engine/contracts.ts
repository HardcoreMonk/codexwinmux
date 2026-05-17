import { nanoid } from 'nanoid';
import { z } from 'zod';

const emptyPayloadSchema = z.object({}).strict();
const unknownRecordSchema = z.record(z.string(), z.unknown());
const coreModesSchema = z.object({
  terminalV2Mode: z.string(),
  storageV2Mode: z.string(),
  timelineV2Mode: z.string(),
  statusV2Mode: z.string(),
}).strict();
const coreErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  retryable: z.boolean(),
}).strict();
const workspaceGroupSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  collapsed: z.boolean(),
}).strict();
const ratioUpdateSchema = z.object({
  path: z.array(z.number().int().nonnegative()),
  ratio: z.number(),
}).strict();
const tabStatusMetadataPatchSchema = z.object({
  sessionName: z.string().min(1),
  agentSessionId: z.string().nullable().optional(),
  agentJsonlPath: z.string().nullable().optional(),
  agentSummary: z.string().nullable().optional(),
  lastUserMessage: z.string().nullable().optional(),
  cliState: z.string().optional(),
  dismissedAt: z.number().int().nonnegative().nullable().optional(),
}).strict();

const commandPayloadSchemas = {
  'core.health': emptyPayloadSchema,
  'core.runtime.phase6': emptyPayloadSchema,
  'core.workspace.list': emptyPayloadSchema,
  'core.workspace.create': z.object({
    name: z.string().min(1),
    defaultCwd: z.string().min(1),
  }).strict(),
  'core.workspace.rename': z.object({
    workspaceId: z.string().min(1),
    name: z.string().min(1),
  }).strict(),
  'core.workspace.delete': z.object({
    workspaceId: z.string().min(1),
  }).strict(),
  'core.workspace.reorder': z.object({
    items: z.array(z.object({
      id: z.string().min(1),
      groupId: z.string().nullable().optional(),
    }).strict()),
  }).strict(),
  'core.workspace.set-group': z.object({
    workspaceId: z.string().min(1),
    groupId: z.string().nullable(),
  }).strict(),
  'core.workspace-group.create': z.object({
    name: z.string().min(1),
  }).strict(),
  'core.workspace-group.rename': z.object({
    groupId: z.string().min(1),
    name: z.string().min(1),
  }).strict(),
  'core.workspace-group.set-collapsed': z.object({
    groupId: z.string().min(1),
    collapsed: z.boolean(),
  }).strict(),
  'core.workspace-group.delete': z.object({
    groupId: z.string().min(1),
  }).strict(),
  'core.workspace-group.reorder': z.object({
    groupIds: z.array(z.string().min(1)),
  }).strict(),
  'core.layout.get': z.object({
    workspaceId: z.string().min(1),
  }).strict(),
  'core.layout.patch': z.object({
    workspaceId: z.string().min(1),
    activePaneId: z.string().min(1).optional(),
    ratioUpdate: ratioUpdateSchema.optional(),
    equalize: z.boolean().optional(),
  }).strict(),
  'core.layout.pane.patch': z.object({
    workspaceId: z.string().min(1),
    paneId: z.string().min(1),
    activeTabId: z.string().min(1).optional(),
  }).strict(),
  'core.layout.pane.split': z.object({
    workspaceId: z.string().min(1),
    sourcePaneId: z.string().min(1),
    orientation: z.enum(['horizontal', 'vertical']),
    cwd: z.string().min(1).optional(),
    panelType: z.string().min(1).optional(),
  }).strict(),
  'core.layout.pane.close': z.object({
    workspaceId: z.string().min(1),
    paneId: z.string().min(1),
  }).strict(),
  'core.layout.tabs.reorder': z.object({
    workspaceId: z.string().min(1),
    paneId: z.string().min(1),
    tabIds: z.array(z.string().min(1)),
  }).strict(),
  'core.layout.tab.move': z.object({
    workspaceId: z.string().min(1),
    tabId: z.string().min(1),
    fromPaneId: z.string().min(1),
    toPaneId: z.string().min(1),
    toIndex: z.number().int().nonnegative(),
  }).strict(),
  'core.layout.tab.patch': z.object({
    workspaceId: z.string().min(1),
    paneId: z.string().min(1),
    tabId: z.string().min(1),
    patch: unknownRecordSchema,
  }).strict(),
  'core.terminal-tab.create': z.object({
    workspaceId: z.string().min(1),
    paneId: z.string().min(1),
    cwd: z.string().min(1),
    ensureWorkspacePane: z.object({
      workspaceName: z.string().min(1),
      defaultCwd: z.string().min(1),
    }).strict().optional(),
  }).strict(),
  'core.terminal-tab.delete': z.object({
    tabId: z.string().min(1),
  }).strict(),
  'core.terminal-tab.restart': z.object({
    workspaceId: z.string().min(1),
    paneId: z.string().min(1),
    tabId: z.string().min(1),
    sessionName: z.string().min(1),
    cwd: z.string().min(1),
    ensureWorkspacePane: z.object({
      workspaceName: z.string().min(1),
      defaultCwd: z.string().min(1),
    }).strict().optional(),
  }).strict(),
  'core.terminal.attach': z.object({
    connectionId: z.string().min(1),
    sessionName: z.string().min(1),
    cols: z.number().int().positive().max(500),
    rows: z.number().int().positive().max(200),
  }).strict(),
  'core.terminal.write': z.object({
    connectionId: z.string().min(1),
    sessionName: z.string().min(1),
    data: z.string(),
  }).strict(),
  'core.terminal.resize': z.object({
    connectionId: z.string().min(1),
    sessionName: z.string().min(1),
    cols: z.number().int().positive().max(500),
    rows: z.number().int().positive().max(200),
  }).strict(),
  'core.terminal.detach': z.object({
    connectionId: z.string().min(1),
    sessionName: z.string().min(1),
  }).strict(),
  'core.terminal-session.info': z.object({
    sessionName: z.string().min(1),
  }).strict(),
  'core.timeline.list-sessions': z.object({
    tmuxSession: z.string().min(1),
    panelType: z.string().min(1),
    offset: z.number().int().nonnegative(),
    limit: z.number().int().positive().max(200),
    cwd: z.string().optional(),
  }).strict(),
  'core.timeline.read-entries-before': z.object({
    jsonlPath: z.string().min(1),
    beforeByte: z.number().int().nonnegative(),
    limit: z.number().int().positive().max(200),
    panelType: z.string().min(1),
  }).strict(),
  'core.timeline.message-counts': z.object({
    jsonlPath: z.string().min(1),
  }).strict(),
  'core.status.live-start': emptyPayloadSchema,
  'core.status.live-hook-event': z.object({
    tmuxSession: z.string().min(1),
    event: z.string().min(1),
    notificationType: z.string().min(1).optional(),
  }).strict(),
  'core.status.live-client-event': z.object({
    eventType: z.enum(['dismiss-tab', 'ack-notification']),
    tabId: z.string().min(1),
    seq: z.number().int().nonnegative().optional(),
  }).strict(),
  'core.status.live-notify-last-user-message': z.object({
    sessionName: z.string().min(1),
    message: z.string(),
  }).strict(),
  'core.status.live-request-sync': emptyPayloadSchema,
  'core.status.live-subscribe': emptyPayloadSchema,
  'core.status.live-unsubscribe': z.object({
    subscriberId: z.string().min(1),
  }).strict(),
  'core.status.live-poll': emptyPayloadSchema,
  'core.status.live-register-tab': z.object({
    tabId: z.string().min(1),
    entry: z.unknown(),
  }).strict(),
  'core.status.live-remove-tab': z.object({
    tabId: z.string().min(1),
  }).strict(),
  'core.status.live-device-visibility': z.object({
    deviceId: z.string().min(1),
    visible: z.boolean(),
  }).strict(),
  'core.status.evaluate-side-effects': z.unknown(),
  'core.status.evaluate-client-event': z.unknown(),
  'core.status.session-history.add': z.object({
    entry: z.unknown(),
  }).strict(),
  'core.status.session-history.update-dismissed-at': z.object({
    tabId: z.string().min(1),
    dismissedAt: z.number().int().nonnegative(),
  }).strict(),
  'core.status.web-push.send': z.object({
    anyDeviceVisible: z.boolean(),
    payload: z.unknown(),
  }).strict(),
  'core.tab-status.patch': tabStatusMetadataPatchSchema,
  'core.tab-status.get': z.object({
    sessionName: z.string().min(1),
  }).strict(),
} as const;

const replyPayloadSchemas = {
  'core.health': z.object({
    ok: z.boolean(),
    runtime: z.unknown().optional(),
    workers: z.unknown().optional(),
  }).passthrough(),
  'core.runtime.phase6': z.object({
    ok: z.boolean(),
    modes: coreModesSchema,
    checks: z.array(z.string()),
    failures: z.array(z.string()),
  }).strict(),
  'core.workspace.list': z.object({
    workspaces: z.array(unknownRecordSchema),
  }).strict(),
  'core.workspace.create': z.object({
    id: z.string().min(1),
    rootPaneId: z.string().min(1),
  }).strict(),
  'core.workspace.rename': z.unknown(),
  'core.workspace.delete': z.unknown(),
  'core.workspace.reorder': z.object({ ok: z.boolean() }).strict(),
  'core.workspace.set-group': z.object({ ok: z.boolean() }).strict(),
  'core.workspace-group.create': workspaceGroupSchema,
  'core.workspace-group.rename': workspaceGroupSchema.nullable(),
  'core.workspace-group.set-collapsed': z.object({ ok: z.boolean() }).strict(),
  'core.workspace-group.delete': z.object({ deleted: z.boolean() }).strict(),
  'core.workspace-group.reorder': z.object({ ok: z.boolean() }).strict(),
  'core.layout.get': z.object({
    layout: z.unknown().nullable(),
  }).strict(),
  'core.layout.patch': z.unknown(),
  'core.layout.pane.patch': z.unknown(),
  'core.layout.pane.split': z.unknown(),
  'core.layout.pane.close': z.unknown(),
  'core.layout.tabs.reorder': z.unknown(),
  'core.layout.tab.move': z.unknown(),
  'core.layout.tab.patch': z.unknown(),
  'core.terminal-tab.create': z.unknown(),
  'core.terminal-tab.delete': z.unknown(),
  'core.terminal-tab.restart': z.unknown(),
  'core.terminal.attach': z.object({
    subscriberId: z.string().min(1),
  }).strict(),
  'core.terminal.write': z.object({ ok: z.literal(true) }).strict(),
  'core.terminal.resize': z.object({ ok: z.literal(true) }).strict(),
  'core.terminal.detach': z.object({ ok: z.literal(true) }).strict(),
  'core.terminal-session.info': z.unknown(),
  'core.timeline.list-sessions': z.object({
    sessions: z.array(unknownRecordSchema),
    total: z.number().int().nonnegative(),
    hasMore: z.boolean(),
  }).strict(),
  'core.timeline.read-entries-before': z.unknown(),
  'core.timeline.message-counts': z.unknown(),
  'core.status.live-start': z.object({
    started: z.boolean(),
  }).strict(),
  'core.status.live-hook-event': z.object({ accepted: z.boolean() }).strict(),
  'core.status.live-client-event': z.object({ accepted: z.boolean() }).strict(),
  'core.status.live-notify-last-user-message': z.object({ accepted: z.boolean() }).strict(),
  'core.status.live-request-sync': z.object({ tabs: z.record(z.string(), z.unknown()) }).strict(),
  'core.status.live-subscribe': z.object({
    subscriberId: z.string().min(1),
    subscribed: z.boolean(),
    sync: z.object({ tabs: z.record(z.string(), z.unknown()) }).strict(),
  }).strict(),
  'core.status.live-unsubscribe': z.object({
    subscriberId: z.string().min(1),
    unsubscribed: z.boolean(),
  }).strict(),
  'core.status.live-poll': z.object({ polled: z.boolean() }).strict(),
  'core.status.live-register-tab': z.object({ accepted: z.boolean() }).strict(),
  'core.status.live-remove-tab': z.object({ accepted: z.boolean() }).strict(),
  'core.status.live-device-visibility': z.object({ accepted: z.boolean() }).strict(),
  'core.status.evaluate-side-effects': z.unknown(),
  'core.status.evaluate-client-event': z.unknown(),
  'core.status.session-history.add': z.unknown(),
  'core.status.session-history.update-dismissed-at': z.unknown(),
  'core.status.web-push.send': z.unknown(),
  'core.tab-status.patch': z.object({
    updated: z.boolean(),
    workspaceId: z.string().nullable(),
    tabId: z.string().nullable(),
  }).strict(),
  'core.tab-status.get': z.unknown(),
} as const;

const eventPayloadSchemas = {
  'core.health-changed': z.object({
    ok: z.boolean(),
  }).passthrough(),
  'core.terminal.stdout': z.object({
    connectionId: z.string().min(1),
    sessionName: z.string().min(1),
    data: z.string(),
  }).strict(),
  'core.terminal.closed': z.object({
    connectionId: z.string().min(1),
    sessionName: z.string().min(1),
    code: z.number().int(),
    reason: z.string(),
  }).strict(),
  'core.status.live-event': z.object({
    subscriberId: z.string().min(1),
    event: z.unknown(),
  }).strict(),
} as const;

export type TCoreCommandType = keyof typeof commandPayloadSchemas;
export type TCoreEventType = keyof typeof eventPayloadSchemas;
export type TCoreCommandPayload<T extends TCoreCommandType> = z.infer<(typeof commandPayloadSchemas)[T]>;
export type TCoreReplyPayload<T extends TCoreCommandType> = z.infer<(typeof replyPayloadSchemas)[T]>;

export interface ICoreCommand<T extends TCoreCommandType = TCoreCommandType> {
  kind: 'command';
  id: string;
  source: 'backend';
  target: 'core';
  type: T;
  payload: TCoreCommandPayload<T>;
}

export interface ICoreReply<T extends TCoreCommandType = TCoreCommandType> {
  kind: 'reply';
  commandId: string;
  source: 'core';
  target: 'backend';
  type: `${T}.reply`;
  ok: boolean;
  payload: TCoreReplyPayload<T> | null;
  error?: ICoreError;
}

export interface ICoreEvent<T extends TCoreEventType = TCoreEventType> {
  kind: 'event';
  id: string;
  source: 'core';
  target: 'backend';
  type: T;
  payload: z.infer<(typeof eventPayloadSchemas)[T]>;
}

export interface ICoreError {
  code: string;
  message: string;
  retryable: boolean;
}

export type TCoreMessage = ICoreCommand | ICoreReply | ICoreEvent;

export const coreCommandTypes = Object.keys(commandPayloadSchemas) as TCoreCommandType[];
export const coreEventTypes = Object.keys(eventPayloadSchemas) as TCoreEventType[];

export const isCoreCommandType = (value: string): value is TCoreCommandType =>
  Object.prototype.hasOwnProperty.call(commandPayloadSchemas, value);

export const parseCoreCommandPayload = <T extends TCoreCommandType>(
  type: T,
  payload: unknown,
): TCoreCommandPayload<T> => {
  try {
    return commandPayloadSchemas[type].parse(payload) as TCoreCommandPayload<T>;
  } catch (err) {
    throw Object.assign(new Error(`Invalid core command payload for ${type}`), {
      code: 'invalid-core-command-payload',
      cause: err,
      retryable: false,
    });
  }
};

export const parseCoreReplyPayload = <T extends TCoreCommandType>(
  type: T,
  payload: unknown,
): TCoreReplyPayload<T> => {
  try {
    return replyPayloadSchemas[type].parse(payload) as TCoreReplyPayload<T>;
  } catch (err) {
    throw Object.assign(new Error(`Invalid core reply payload for ${type}`), {
      code: 'invalid-core-reply-payload',
      cause: err,
      retryable: false,
    });
  }
};

export const parseCoreEventPayload = <T extends TCoreEventType>(
  type: T,
  payload: unknown,
): z.infer<(typeof eventPayloadSchemas)[T]> => {
  try {
    return eventPayloadSchemas[type].parse(payload) as z.infer<(typeof eventPayloadSchemas)[T]>;
  } catch (err) {
    throw Object.assign(new Error(`Invalid core event payload for ${type}`), {
      code: 'invalid-core-event-payload',
      cause: err,
      retryable: false,
    });
  }
};

export const createCoreCommand = <T extends TCoreCommandType>({
  id = `core-${nanoid()}`,
  type,
  payload,
}: {
  id?: string;
  type: T;
  payload: TCoreCommandPayload<T>;
}): ICoreCommand<T> => ({
  kind: 'command',
  id,
  source: 'backend',
  target: 'core',
  type,
  payload: parseCoreCommandPayload(type, payload),
});

export const createCoreReply = <T extends TCoreCommandType>({
  command,
  ok,
  payload,
  error,
}: {
  command: Pick<ICoreCommand<T>, 'id' | 'type'>;
  ok: boolean;
  payload: TCoreReplyPayload<T> | null;
  error?: ICoreError;
}): ICoreReply<T> => ({
  kind: 'reply',
  commandId: command.id,
  source: 'core',
  target: 'backend',
  type: `${command.type}.reply`,
  ok,
  payload: ok && payload !== null ? parseCoreReplyPayload(command.type, payload) : null,
  ...(error ? { error: coreErrorSchema.parse(error) } : {}),
});

export const createCoreEvent = <T extends TCoreEventType>({
  id = `core-event-${nanoid()}`,
  type,
  payload,
}: {
  id?: string;
  type: T;
  payload: z.infer<(typeof eventPayloadSchemas)[T]>;
}): ICoreEvent<T> => ({
  kind: 'event',
  id,
  source: 'core',
  target: 'backend',
  type,
  payload: parseCoreEventPayload(type, payload),
});

export const parseCoreReply = (message: unknown): ICoreReply => {
  const base = z.object({
    kind: z.literal('reply'),
    commandId: z.string().min(1),
    source: z.literal('core'),
    target: z.literal('backend'),
    type: z.string().min(1),
    ok: z.boolean(),
    payload: z.unknown().nullable(),
    error: coreErrorSchema.optional(),
  }).strict().parse(message);
  const commandType = base.type.endsWith('.reply')
    ? base.type.slice(0, -'.reply'.length)
    : base.type;
  if (!isCoreCommandType(commandType)) {
    throw Object.assign(new Error(`Unsupported core reply type: ${base.type}`), {
      code: 'unsupported-core-reply',
      retryable: false,
    });
  }
  return {
    ...base,
    type: `${commandType}.reply`,
    payload: base.ok ? parseCoreReplyPayload(commandType, base.payload) : null,
  } as ICoreReply;
};

export const parseCoreEvent = (message: unknown): ICoreEvent => {
  const base = z.object({
    kind: z.literal('event'),
    id: z.string().min(1),
    source: z.literal('core'),
    target: z.literal('backend'),
    type: z.string().min(1),
    payload: z.unknown(),
  }).strict().parse(message);
  if (!Object.prototype.hasOwnProperty.call(eventPayloadSchemas, base.type)) {
    throw Object.assign(new Error(`Unsupported core event type: ${base.type}`), {
      code: 'unsupported-core-event',
      retryable: false,
    });
  }
  return {
    ...base,
    type: base.type,
    payload: parseCoreEventPayload(base.type as TCoreEventType, base.payload),
  } as ICoreEvent;
};

export const parseCoreCommand = (message: unknown): ICoreCommand => {
  const base = z.object({
    kind: z.literal('command'),
    id: z.string().min(1),
    source: z.literal('backend'),
    target: z.literal('core'),
    type: z.string().min(1),
    payload: z.unknown(),
  }).strict().parse(message);
  if (!isCoreCommandType(base.type)) {
    throw Object.assign(new Error(`Unsupported core command type: ${base.type}`), {
      code: 'unsupported-core-command',
      retryable: false,
    });
  }
  return {
    ...base,
    type: base.type,
    payload: parseCoreCommandPayload(base.type, base.payload),
  } as ICoreCommand;
};
