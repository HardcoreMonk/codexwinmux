import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import type {
  TApprovalKind,
  TApprovalPromptType,
  TApprovalRiskLevel,
} from '@/lib/permission-prompt';
import type { TApprovalFallbackReason } from '@/lib/approval-queue';

export type TApprovalAuditEventType =
  | 'options-ready'
  | 'fallback'
  | 'selection-sent'
  | 'selection-failed';

export interface IApprovalAuditEventInput {
  eventType: TApprovalAuditEventType;
  workspaceId: string;
  tabId: string;
  promptType?: TApprovalPromptType;
  approvalKind?: TApprovalKind;
  riskLevel?: TApprovalRiskLevel;
  selectedOptionIndex?: number;
  optionCount?: number;
  fallbackReason?: TApprovalFallbackReason;
}

export interface IApprovalAuditEvent {
  id: string;
  createdAt: string;
  eventType: TApprovalAuditEventType;
  workspaceId: string;
  tabId: string;
  promptType: TApprovalPromptType;
  approvalKind: TApprovalKind;
  riskLevel: TApprovalRiskLevel;
  selectedOptionIndex: number | null;
  optionCount: number | null;
  fallbackReason: TApprovalFallbackReason | null;
}

export interface IReadApprovalAuditEventsOptions {
  limit?: number;
}

const promptTypes = new Set<TApprovalPromptType>([
  'command',
  'file',
  'permission',
  'resume-directory',
  'conversation',
  'unknown',
]);
const approvalKinds = new Set<TApprovalKind>(['allow', 'deny', 'trust', 'directory', 'input', 'unknown']);
const riskLevels = new Set<TApprovalRiskLevel>(['low', 'medium', 'high', 'unknown']);
const fallbackReasons = new Set<TApprovalFallbackReason>([
  'no-session',
  'capture-empty',
  'parse-empty',
  'send-failed',
  'request-failed',
]);

const getHomeDir = (): string =>
  process.env.HOME || process.env.USERPROFILE || os.homedir() || '/';

const getAuditFilePath = (): string =>
  path.join(getHomeDir(), '.codexwinmux', 'approval-audit.jsonl');

const cleanId = (value: string): string => value.trim().slice(0, 120);

const cleanIndex = (value: number | undefined): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;

const cleanCount = (value: number | undefined): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;

const normalizeEvent = (input: IApprovalAuditEventInput): IApprovalAuditEvent => ({
  id: randomUUID(),
  createdAt: new Date().toISOString(),
  eventType: input.eventType,
  workspaceId: cleanId(input.workspaceId),
  tabId: cleanId(input.tabId),
  promptType: promptTypes.has(input.promptType ?? 'unknown') ? input.promptType ?? 'unknown' : 'unknown',
  approvalKind: approvalKinds.has(input.approvalKind ?? 'unknown') ? input.approvalKind ?? 'unknown' : 'unknown',
  riskLevel: riskLevels.has(input.riskLevel ?? 'unknown') ? input.riskLevel ?? 'unknown' : 'unknown',
  selectedOptionIndex: cleanIndex(input.selectedOptionIndex),
  optionCount: cleanCount(input.optionCount),
  fallbackReason: fallbackReasons.has(input.fallbackReason ?? 'request-failed')
    ? input.fallbackReason ?? null
    : 'request-failed',
});

const parseLine = (line: string): IApprovalAuditEvent | null => {
  try {
    const parsed = JSON.parse(line) as IApprovalAuditEvent;
    if (!parsed.id || !parsed.createdAt || !parsed.workspaceId || !parsed.tabId) return null;
    return parsed;
  } catch {
    return null;
  }
};

export const appendApprovalAuditEvent = async (
  input: IApprovalAuditEventInput,
): Promise<IApprovalAuditEvent> => {
  const event = normalizeEvent(input);
  const filePath = getAuditFilePath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, `${JSON.stringify(event)}\n`, { mode: 0o600 });
  return event;
};

export const readApprovalAuditEvents = async (
  options: IReadApprovalAuditEventsOptions = {},
): Promise<IApprovalAuditEvent[]> => {
  const limit = Math.max(1, Math.min(500, Math.floor(options.limit ?? 100)));
  try {
    const raw = await fs.readFile(getAuditFilePath(), 'utf-8');
    return raw
      .split('\n')
      .filter(Boolean)
      .map(parseLine)
      .filter((event): event is IApprovalAuditEvent => !!event)
      .slice(-limit)
      .reverse();
  } catch {
    return [];
  }
};
