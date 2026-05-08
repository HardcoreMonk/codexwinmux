import { createProviderTimelineEntryId } from '@/lib/timeline-entry-id';
import type {
  ITimelineAgentGroup,
  ITimelineAssistantMessage,
  ITimelineEntry,
  ITimelineThinking,
  ITimelineToolCall,
  ITimelineToolResult,
  ITimelineUserMessage,
  TToolStatus,
} from '@/types/timeline';

type TCodexAppServerUserInput = {
  type?: string;
  text?: string;
};

type TCodexAppServerKnownThreadItem =
  | { type: 'userMessage'; id: string; content: TCodexAppServerUserInput[] }
  | { type: 'agentMessage'; id: string; text: string; phase?: string | null }
  | { type: 'reasoning'; id: string; summary?: string[]; content?: string[] }
  | {
    type: 'commandExecution';
    id: string;
    command: string;
    status: string;
    aggregatedOutput?: string | null;
    exitCode?: number | null;
  }
  | {
    type: 'collabAgentToolCall';
    id: string;
    tool: string;
    status: string;
    prompt?: string | null;
    receiverThreadIds?: string[];
    agentsStates?: Record<string, unknown>;
  };

type TCodexAppServerThreadItem =
  | TCodexAppServerKnownThreadItem
  | { type: string; id?: string };

interface ICodexAppServerTurn {
  id: string;
  items: TCodexAppServerThreadItem[];
  startedAt?: number | null;
  completedAt?: number | null;
}

interface ICodexAppServerThread {
  id: string;
  turns: ICodexAppServerTurn[];
}

const PROVIDER_ID = 'codex-app-server';

const toTimestamp = (turn: ICodexAppServerTurn): number => {
  const rawSeconds = turn.startedAt ?? turn.completedAt;
  return typeof rawSeconds === 'number' && Number.isFinite(rawSeconds)
    ? rawSeconds * 1000
    : Date.now();
};

const createId = (item: { id?: string; type: string }, type: ITimelineEntry['type']): string =>
  createProviderTimelineEntryId({
    providerId: PROVIDER_ID,
    recordId: item.id || `${item.type}:${type}`,
    type,
  });

const commandStatusToToolStatus = (status: string, exitCode?: number | null): TToolStatus => {
  if (status === 'failed' || status === 'declined') return 'error';
  if (status === 'completed') return exitCode && exitCode !== 0 ? 'error' : 'success';
  return 'pending';
};

const summarizeCommandOutput = (output: string | null | undefined, isError: boolean): string => {
  if (isError) return output?.split('\n').find((line) => line.trim())?.slice(0, 100) || 'error';
  if (!output?.trim()) return '';
  const lines = output.trim().split('\n');
  return lines.length > 1 ? `${lines.length} lines` : lines[0].slice(0, 100);
};

const parseTextInput = (content: TCodexAppServerUserInput[]): string =>
  content
    .filter((item) => item.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text?.trim())
    .filter((text): text is string => Boolean(text))
    .join('\n\n');

const isItemType = <TType extends TCodexAppServerKnownThreadItem['type']>(
  item: TCodexAppServerThreadItem,
  type: TType,
): item is Extract<TCodexAppServerKnownThreadItem, { type: TType }> => item.type === type;

const parseItem = (
  item: TCodexAppServerThreadItem,
  turn: ICodexAppServerTurn,
): ITimelineEntry[] => {
  const timestamp = toTimestamp(turn);

  if (isItemType(item, 'userMessage')) {
    const text = parseTextInput(item.content);
    if (!text) return [];
    const entry: ITimelineUserMessage = {
      id: createId(item, 'user-message'),
      type: 'user-message',
      timestamp,
      text,
    };
    return [entry];
  }

  if (isItemType(item, 'agentMessage')) {
    const markdown = item.text.trim();
    if (!markdown) return [];
    const entry: ITimelineAssistantMessage = {
      id: createId(item, 'assistant-message'),
      type: 'assistant-message',
      timestamp,
      markdown,
    };
    return [entry];
  }

  if (isItemType(item, 'reasoning')) {
    const thinking = [...(item.summary ?? []), ...(item.content ?? [])].map((part) => part.trim()).filter(Boolean).join('\n\n');
    if (!thinking) return [];
    const entry: ITimelineThinking = {
      id: createId(item, 'thinking'),
      type: 'thinking',
      timestamp,
      thinking,
    };
    return [entry];
  }

  if (isItemType(item, 'commandExecution')) {
    const status = commandStatusToToolStatus(item.status, item.exitCode);
    const toolCall: ITimelineToolCall = {
      id: createId(item, 'tool-call'),
      type: 'tool-call',
      timestamp,
      toolUseId: item.id,
      toolName: 'Command',
      summary: `$ ${item.command.split('\n')[0]}`,
      status,
    };
    const output = summarizeCommandOutput(item.aggregatedOutput, status === 'error');
    const toolResult: ITimelineToolResult = {
      id: createProviderTimelineEntryId({
        providerId: PROVIDER_ID,
        recordId: `${item.id}:result`,
        type: 'tool-result',
      }),
      type: 'tool-result',
      timestamp,
      toolUseId: item.id,
      isError: status === 'error',
      summary: output,
    };
    return output ? [toolCall, toolResult] : [toolCall];
  }

  if (isItemType(item, 'collabAgentToolCall')) {
    const description = item.prompt?.trim()
      || item.receiverThreadIds?.join(', ')
      || item.tool;
    const entry: ITimelineAgentGroup = {
      id: createId(item, 'agent-group'),
      type: 'agent-group',
      timestamp,
      agentType: item.tool,
      description,
      entryCount: item.receiverThreadIds?.length || 1,
      entries: [],
    };
    return [entry];
  }

  return [];
};

export const parseCodexAppServerThread = (thread: ICodexAppServerThread): ITimelineEntry[] =>
  thread.turns.flatMap((turn) => turn.items.flatMap((item) => parseItem(item, turn)));

export const codexAppServerProtocolAdapter = {
  providerId: PROVIDER_ID,
  protocolVersion: 'app-server-v2',
  runtimeProviderReady: false,
  parseThread: parseCodexAppServerThread,
} as const;
