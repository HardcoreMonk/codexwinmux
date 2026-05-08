import type { NextApiRequest, NextApiResponse } from 'next';
import {
  appendApprovalAuditEvent,
  readApprovalAuditEvents,
  type IApprovalAuditEventInput,
  type TApprovalAuditEventType,
} from '@/lib/approval-audit-store';
import type {
  TApprovalKind,
  TApprovalPromptType,
  TApprovalRiskLevel,
} from '@/lib/permission-prompt';
import type { TApprovalFallbackReason } from '@/lib/approval-queue';

const eventTypes = new Set<TApprovalAuditEventType>([
  'options-ready',
  'fallback',
  'selection-sent',
  'selection-failed',
]);
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
  'capture-failed',
  'parse-empty',
  'send-failed',
  'request-failed',
]);

const readString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const readEnum = <T extends string>(value: unknown, allowed: Set<T>): T | undefined =>
  typeof value === 'string' && allowed.has(value as T) ? value as T : undefined;

const readInteger = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;

const parseLimit = (value: unknown): number => {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = typeof raw === 'string' ? Number.parseInt(raw, 10) : 100;
  return Number.isFinite(parsed) ? Math.max(1, Math.min(200, parsed)) : 100;
};

const parseAuditInput = (body: unknown): IApprovalAuditEventInput | null => {
  if (!body || typeof body !== 'object') return null;
  const data = body as Record<string, unknown>;
  const eventType = readEnum(data.eventType, eventTypes);
  const workspaceId = readString(data.workspaceId);
  const tabId = readString(data.tabId);
  if (!eventType || !workspaceId || !tabId) return null;

  return {
    eventType,
    workspaceId,
    tabId,
    promptType: readEnum(data.promptType, promptTypes),
    approvalKind: readEnum(data.approvalKind, approvalKinds),
    riskLevel: readEnum(data.riskLevel, riskLevels),
    selectedOptionIndex: readInteger(data.selectedOptionIndex),
    optionCount: readInteger(data.optionCount),
    fallbackReason: readEnum(data.fallbackReason, fallbackReasons),
  };
};

const handler = async (req: NextApiRequest, res: NextApiResponse): Promise<void> => {
  if (req.method === 'GET') {
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ events: await readApprovalAuditEvents({ limit: parseLimit(req.query.limit) }) });
    return;
  }

  if (req.method === 'POST') {
    const input = parseAuditInput(req.body);
    if (!input) {
      res.status(400).json({ error: 'invalid-approval-audit-event' });
      return;
    }
    res.status(200).json({ event: await appendApprovalAuditEvent(input) });
    return;
  }

  res.setHeader('Allow', 'GET, POST');
  res.status(405).json({ error: 'Method not allowed' });
};

export default handler;
