import type {
  IChunkReadResult,
  IIncrementalResult,
  ITimelineEntry,
  ITimelineUserMessage,
  ITimelineAssistantMessage,
  ITimelineThinking,
  ITimelineToolCall,
  ITimelineToolResult,
  ITimelineAgentGroup,
  TToolStatus,
} from '@/types/timeline';
import fs from 'fs/promises';
import { createTimelineEntryId } from '@/lib/timeline-entry-id';

interface ICodexRolloutRecord {
  type?: string;
  timestamp?: string;
  payload?: Record<string, unknown>;
}

interface ICodexParseResult {
  entries: ITimelineEntry[];
  entryLineOffsets: number[];
  lastOffset: number;
  errorCount: number;
  summary?: string;
}

interface IPendingAgentCall {
  callId: string;
  agentType: string;
  description: string;
  timestamp: number;
  lineOffset: number;
  source: string;
}

const toTimestamp = (value: unknown): number => {
  if (typeof value !== 'string') return Date.now();
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : Date.now();
};

const tryParseJson = (value: unknown): Record<string, unknown> => {
  if (typeof value !== 'string' || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
};

const truncate = (value: string, max = 120): string =>
  value.length > max ? `${value.slice(0, max)}...` : value;

const MESSAGE_PAIR_DEDUPE_WINDOW_MS = 1_000;

const extractTextItems = (content: unknown): string[] => {
  if (typeof content === 'string') return [content];
  if (!Array.isArray(content)) return [];

  const result: string[] = [];
  for (const item of content) {
    if (!item || typeof item !== 'object') continue;
    const block = item as Record<string, unknown>;
    const text = block.text;
    if (typeof text === 'string' && text.trim()) result.push(text);
  }
  return result;
};

const isImageWrapperText = (text: string): boolean => {
  const trimmed = text.trim();
  return /^<image(?:\s|>|$)/.test(trimmed) || trimmed === '</image>';
};

const extractUserTextItems = (content: unknown): string[] =>
  extractTextItems(content).filter((text) => !isImageWrapperText(text));

const isSyntheticUserContext = (text: string): boolean => {
  const trimmed = text.trimStart();
  return trimmed.startsWith('<environment_context>')
    || trimmed.startsWith('# AGENTS.md instructions for ');
};

const summarizeCodexToolCall = (name: string, input: Record<string, unknown>): string => {
  switch (name) {
    case 'exec_command': {
      const cmd = String(input.cmd ?? '').split('\n')[0];
      return cmd ? `$ ${cmd}` : 'Execute command';
    }
    case 'write_stdin': {
      const sessionId = input.session_id;
      return sessionId === undefined ? 'Write stdin' : `Write stdin ${sessionId}`;
    }
    default: {
      const firstKey = Object.keys(input)[0];
      const firstVal = firstKey ? String(input[firstKey]).split('\n')[0] : '';
      return truncate(`${name}${firstVal ? ` ${firstVal}` : ''}`);
    }
  }
};

const isAgentForkToolName = (name: string): boolean =>
  name === 'spawn_agent' || name === 'Agent';

const toShortText = (value: unknown, max = 120): string => {
  if (typeof value !== 'string') return '';
  return truncate(value.trim(), max);
};

const buildPendingAgentCall = (
  payload: Record<string, unknown>,
  timestamp: number,
  lineOffset: number,
  source: string,
): IPendingAgentCall | null => {
  if (payload.type !== 'function_call') return null;
  const name = typeof payload.name === 'string' ? payload.name : '';
  if (!isAgentForkToolName(name)) return null;
  const callId = typeof payload.call_id === 'string' ? payload.call_id : '';
  if (!callId) return null;

  const input = tryParseJson(payload.arguments);
  const agentType = toShortText(input.agent_type ?? input.subagent_type ?? input.type, 40) || 'Agent';
  const description = toShortText(input.message ?? input.description ?? input.prompt, 160) || 'Sub-agent';

  return {
    callId,
    agentType,
    description,
    timestamp,
    lineOffset,
    source,
  };
};

const createAgentResultEntry = (
  pending: IPendingAgentCall,
  output: string,
  lineOffset: number,
  source: string,
): ITimelineAssistantMessage | null => {
  const markdown = output.trim();
  if (!markdown) return null;
  return {
    id: createTimelineEntryId({
      lineOffset,
      entryIndex: 0,
      type: 'assistant-message',
      source,
    }),
    type: 'assistant-message',
    timestamp: pending.timestamp,
    markdown,
  };
};

const createAgentGroup = (
  pending: IPendingAgentCall,
  output: string,
  lineOffset: number,
  source: string,
): ITimelineAgentGroup => {
  const resultEntry = createAgentResultEntry(pending, output, lineOffset, source);
  return {
    id: createTimelineEntryId({
      lineOffset: pending.lineOffset,
      entryIndex: 0,
      type: 'agent-group',
      source: [pending.source, source],
    }),
    type: 'agent-group',
    timestamp: pending.timestamp,
    agentType: pending.agentType,
    description: pending.description,
    entryCount: 2,
    entries: resultEntry ? [resultEntry] : [],
  };
};

const parseMessage = (
  payload: Record<string, unknown>,
  timestamp: number,
): ITimelineUserMessage | ITimelineAssistantMessage | null => {
  const role = payload.role;
  if (role !== 'user' && role !== 'assistant') return null;
  const textItems = role === 'user'
    ? extractUserTextItems(payload.content)
    : extractTextItems(payload.content);
  const text = textItems.join('\n\n').trim();
  if (!text) return null;
  if (role === 'user' && isSyntheticUserContext(text)) return null;

  if (role === 'user') {
    return {
      id: '',
      type: 'user-message',
      timestamp,
      text,
    };
  }

  return {
    id: '',
    type: 'assistant-message',
    timestamp,
    markdown: text,
  };
};

const parseEventMessage = (
  payload: Record<string, unknown>,
  timestamp: number,
): ITimelineUserMessage | ITimelineAssistantMessage | null => {
  if (payload.type === 'user_message') {
    const text = typeof payload.message === 'string' ? payload.message.trim() : '';
    if (!text) return null;
    return {
      id: '',
      type: 'user-message',
      timestamp,
      text,
    };
  }

  if (payload.type === 'agent_message') {
    const text = typeof payload.message === 'string' ? payload.message.trim() : '';
    if (!text) return null;
    return {
      id: '',
      type: 'assistant-message',
      timestamp,
      markdown: text,
    };
  }

  return null;
};

const getMessageText = (entry: ITimelineUserMessage | ITimelineAssistantMessage): string =>
  entry.type === 'user-message' ? entry.text : entry.markdown;

const getMessageDedupeKey = (entry: ITimelineUserMessage | ITimelineAssistantMessage): string =>
  [entry.type, getMessageText(entry).replace(/\r\n/g, '\n').trim()].join(':');

const hasRecentMessage = (
  seenMessages: Map<string, number>,
  entry: ITimelineUserMessage | ITimelineAssistantMessage,
  timestamp: number,
): boolean => {
  const key = getMessageDedupeKey(entry);
  const seenAt = seenMessages.get(key);
  if (seenAt !== undefined && Math.abs(timestamp - seenAt) <= MESSAGE_PAIR_DEDUPE_WINDOW_MS) {
    return true;
  }
  seenMessages.set(key, timestamp);
  return false;
};

const parseReasoning = (
  payload: Record<string, unknown>,
  timestamp: number,
): ITimelineThinking | null => {
  if (payload.type !== 'reasoning') return null;
  const visible: string[] = [];
  if (Array.isArray(payload.summary)) {
    visible.push(...payload.summary.filter((v): v is string => typeof v === 'string' && !!v.trim()));
  }
  if (Array.isArray(payload.content)) {
    visible.push(...payload.content.filter((v): v is string => typeof v === 'string' && !!v.trim()));
  } else if (typeof payload.content === 'string' && payload.content.trim()) {
    visible.push(payload.content);
  }

  const thinking = visible.join('\n\n').trim();
  if (!thinking) return null;
  return {
    id: '',
    type: 'thinking',
    timestamp,
    thinking,
  };
};

const parseToolCall = (
  payload: Record<string, unknown>,
  timestamp: number,
): ITimelineToolCall | null => {
  if (payload.type !== 'function_call') return null;
  const name = typeof payload.name === 'string' ? payload.name : 'tool';
  const callId = typeof payload.call_id === 'string' ? payload.call_id : `missing-call-${timestamp}`;
  const input = tryParseJson(payload.arguments);
  return {
    id: '',
    type: 'tool-call',
    timestamp,
    toolUseId: callId,
    toolName: name,
    summary: summarizeCodexToolCall(name, input),
    status: 'pending',
  };
};

const parseToolResult = (
  payload: Record<string, unknown>,
  timestamp: number,
): ITimelineToolResult | null => {
  if (payload.type !== 'function_call_output') return null;
  const callId = typeof payload.call_id === 'string' ? payload.call_id : `missing-output-${timestamp}`;
  const output = typeof payload.output === 'string' ? payload.output : '';
  const isError = /status:\s*failed|Process exited with code [1-9]/i.test(output);
  const lines = output.split('\n').filter((line) => line.trim());
  const summary = lines.length > 1 ? `${lines.length} lines` : truncate(lines[0] ?? '');
  return {
    id: '',
    type: 'tool-result',
    timestamp,
    toolUseId: callId,
    isError,
    summary,
  };
};

const updateToolStatuses = (entries: ITimelineEntry[]): ITimelineEntry[] => {
  const finalStatus = new Map<string, TToolStatus>();
  for (const entry of entries) {
    if (entry.type === 'tool-result') {
      finalStatus.set(entry.toolUseId, entry.isError ? 'error' : 'success');
    }
  }
  return entries.map((entry) => {
    if (entry.type !== 'tool-call') return entry;
    const status = finalStatus.get(entry.toolUseId);
    return status ? { ...entry, status } : entry;
  });
};

const parseCodexContent = (content: string, baseOffset = 0): ICodexParseResult => {
  const entries: ITimelineEntry[] = [];
  const entryLineOffsets: number[] = [];
  const seenMessages = new Map<string, number>();
  const pendingAgentCalls = new Map<string, IPendingAgentCall>();
  let errorCount = 0;
  let summary: string | undefined;
  let bytePos = 0;

  for (const line of content.split('\n')) {
    const lineByteOffset = baseOffset + bytePos;
    bytePos += Buffer.byteLength(line, 'utf-8') + 1;
    const trimmed = line.trim();
    if (!trimmed) continue;
    let lineEntryIndex = 0;
    const pushEntry = (entry: ITimelineEntry) => {
      entries.push({
        ...entry,
        id: createTimelineEntryId({
          lineOffset: lineByteOffset,
          entryIndex: lineEntryIndex,
          type: entry.type,
          source: trimmed,
        }),
      });
      entryLineOffsets.push(lineByteOffset);
      lineEntryIndex++;
    };

    let record: ICodexRolloutRecord;
    try {
      record = JSON.parse(trimmed) as ICodexRolloutRecord;
    } catch {
      errorCount++;
      continue;
    }

    const payload = record.payload;
    if (!payload || typeof payload !== 'object') continue;
    const timestamp = toTimestamp(record.timestamp);

    if (record.type === 'event_msg') {
      const message = parseEventMessage(payload, timestamp);
      if (message && !hasRecentMessage(seenMessages, message, timestamp)) {
        pushEntry(message);
        if (!summary && message.type === 'user-message') summary = truncate(message.text, 200);
      }
      continue;
    }

    if (record.type !== 'response_item') continue;

    const pendingAgent = buildPendingAgentCall(payload, timestamp, lineByteOffset, trimmed);
    if (pendingAgent) {
      pendingAgentCalls.set(pendingAgent.callId, pendingAgent);
      continue;
    }

    if (payload.type === 'function_call_output') {
      const callId = typeof payload.call_id === 'string' ? payload.call_id : '';
      const pending = pendingAgentCalls.get(callId);
      if (pending) {
        pendingAgentCalls.delete(callId);
        const output = typeof payload.output === 'string' ? payload.output : '';
        const agentGroup = createAgentGroup(pending, output, lineByteOffset, trimmed);
        entries.push(agentGroup);
        entryLineOffsets.push(pending.lineOffset);
        continue;
      }
    }

    const message = parseMessage(payload, timestamp);
    if (message) {
      if (!hasRecentMessage(seenMessages, message, timestamp)) {
        pushEntry(message);
        if (!summary && message.type === 'user-message') summary = truncate(message.text, 200);
      }
      continue;
    }

    const reasoning = parseReasoning(payload, timestamp);
    if (reasoning) {
      pushEntry(reasoning);
      continue;
    }

    const toolCall = parseToolCall(payload, timestamp);
    if (toolCall) {
      pushEntry(toolCall);
      continue;
    }

    const toolResult = parseToolResult(payload, timestamp);
    if (toolResult) {
      pushEntry(toolResult);
    }
  }

  return {
    entries: updateToolStatuses(entries),
    entryLineOffsets,
    lastOffset: Buffer.byteLength(content, 'utf-8'),
    errorCount,
    summary,
  };
};

export const parseCodexJsonlContent = (content: string): ITimelineEntry[] => {
  return parseCodexContent(content).entries;
};

const CHUNK_SIZE = 256_000;
const SMALL_FILE_THRESHOLD = CHUNK_SIZE;

const readChunk = async (
  filePath: string,
  from: number,
  to: number,
): Promise<{ content: string; validFrom: number }> => {
  const readSize = to - from;
  if (readSize <= 0) return { content: '', validFrom: from };
  const handle = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(readSize);
    await handle.read(buffer, 0, readSize, from);
    const raw = buffer.toString('utf-8');
    if (from === 0) return { content: raw, validFrom: 0 };

    const firstNewline = raw.indexOf('\n');
    if (firstNewline < 0) return { content: '', validFrom: to };
    return {
      content: raw.slice(firstNewline + 1),
      validFrom: from + Buffer.byteLength(raw.slice(0, firstNewline + 1), 'utf-8'),
    };
  } finally {
    await handle.close();
  }
};

export const readCodexTailEntries = async (
  filePath: string,
  maxEntries: number,
): Promise<IChunkReadResult> => {
  const empty: IChunkReadResult = {
    entries: [],
    startByteOffset: 0,
    fileSize: 0,
    hasMore: false,
    errorCount: 0,
  };

  try {
    const stat = await fs.stat(filePath);
    const fileSize = stat.size;
    if (fileSize === 0) return empty;

    if (fileSize <= SMALL_FILE_THRESHOLD) {
      const content = await fs.readFile(filePath, 'utf-8');
      const result = parseCodexContent(content);
      const sliced = result.entries.length > maxEntries;
      const sliceStart = sliced ? result.entries.length - maxEntries : 0;
      return {
        entries: sliced ? result.entries.slice(-maxEntries) : result.entries,
        startByteOffset: sliced ? result.entryLineOffsets[sliceStart] : 0,
        fileSize,
        hasMore: sliced,
        errorCount: result.errorCount,
        summary: result.summary,
      };
    }

    let chunkSize = CHUNK_SIZE;
    while (chunkSize < fileSize * 2) {
      const from = Math.max(0, fileSize - chunkSize);
      const { content, validFrom } = await readChunk(filePath, from, fileSize);
      if (!content) {
        chunkSize *= 2;
        continue;
      }
      const result = parseCodexContent(content, validFrom);
      if (result.entries.length >= maxEntries || from === 0) {
        const sliced = result.entries.length > maxEntries;
        const sliceStart = sliced ? result.entries.length - maxEntries : 0;
        const startByteOffset = sliced
          ? validFrom + result.entryLineOffsets[sliceStart]
          : (from === 0 ? 0 : validFrom);
        return {
          entries: sliced ? result.entries.slice(-maxEntries) : result.entries,
          startByteOffset,
          fileSize,
          hasMore: startByteOffset > 0,
          errorCount: result.errorCount,
          summary: result.summary,
        };
      }
      chunkSize *= 2;
    }

    return empty;
  } catch {
    return empty;
  }
};

export const readCodexEntriesBefore = async (
  filePath: string,
  beforeByte: number,
  maxEntries: number,
): Promise<IChunkReadResult> => {
  const empty: IChunkReadResult = {
    entries: [],
    startByteOffset: 0,
    fileSize: 0,
    hasMore: false,
    errorCount: 0,
  };

  try {
    if (beforeByte <= 0) return empty;
    const stat = await fs.stat(filePath);

    let chunkSize = CHUNK_SIZE;
    while (true) {
      const from = Math.max(0, beforeByte - chunkSize);
      const { content, validFrom } = await readChunk(filePath, from, beforeByte);
      if (content) {
        const result = parseCodexContent(content, validFrom);
        if (result.entries.length >= maxEntries || from === 0) {
          const sliced = result.entries.length > maxEntries;
          const sliceStart = sliced ? result.entries.length - maxEntries : 0;
          const startByteOffset = sliced
            ? validFrom + result.entryLineOffsets[sliceStart]
            : (from === 0 ? 0 : validFrom);
          return {
            entries: sliced ? result.entries.slice(-maxEntries) : result.entries,
            startByteOffset,
            fileSize: stat.size,
            hasMore: startByteOffset > 0,
            errorCount: result.errorCount,
            summary: result.summary,
          };
        }
      }
      if (from === 0) return empty;
      chunkSize *= 2;
    }
  } catch {
    return empty;
  }
};

export const parseCodexIncremental = async (
  filePath: string,
  fromOffset: number,
  pendingBuffer = '',
): Promise<IIncrementalResult> => {
  try {
    const handle = await fs.open(filePath, 'r');
    const stat = await handle.stat();
    const size = stat.size;

    if (size < fromOffset) {
      await handle.close();
      const content = await fs.readFile(filePath, 'utf-8');
      const result = parseCodexContent(content);
      return { newEntries: result.entries, newOffset: size, pendingBuffer: '' };
    }

    if (fromOffset >= size) {
      await handle.close();
      return { newEntries: [], newOffset: fromOffset, pendingBuffer };
    }

    const buffer = Buffer.alloc(size - fromOffset);
    await handle.read(buffer, 0, buffer.length, fromOffset);
    await handle.close();

    const rawContent = pendingBuffer + buffer.toString('utf-8');
    const endsWithNewline = rawContent.endsWith('\n');
    const segments = rawContent.split('\n');
    let newPending = '';
    if (!endsWithNewline) {
      const lastSegment = segments.pop() ?? '';
      if (lastSegment) {
        try {
          JSON.parse(lastSegment);
          segments.push(lastSegment);
        } catch {
          newPending = lastSegment;
        }
      }
    }

    const contentBaseOffset = Math.max(0, fromOffset - Buffer.byteLength(pendingBuffer, 'utf-8'));
    const result = parseCodexContent(segments.join('\n'), contentBaseOffset);
    return {
      newEntries: result.entries,
      newOffset: size,
      pendingBuffer: newPending,
    };
  } catch {
    return { newEntries: [], newOffset: fromOffset, pendingBuffer };
  }
};
