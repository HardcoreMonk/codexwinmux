import type {
  IApprovalPromptMetadata,
  TApprovalPromptType,
  TApprovalRiskLevel,
} from '@/lib/permission-prompt';

export type TApprovalFallbackReason =
  | 'no-session'
  | 'capture-empty'
  | 'capture-failed'
  | 'parse-empty'
  | 'send-failed'
  | 'request-failed';

const APPROVAL_PROMPT_TYPE_KEYS: Record<TApprovalPromptType, string> = {
  command: 'approvalType_command',
  file: 'approvalType_file',
  permission: 'approvalType_permission',
  'resume-directory': 'approvalType_resumeDirectory',
  conversation: 'approvalType_conversation',
  unknown: 'approvalType_unknown',
};

const APPROVAL_RISK_KEYS: Record<TApprovalRiskLevel, string> = {
  high: 'approvalRisk_high',
  medium: 'approvalRisk_medium',
  low: 'approvalRisk_low',
  unknown: 'approvalRisk_unknown',
};

const APPROVAL_FALLBACK_KEYS: Record<TApprovalFallbackReason, string> = {
  'no-session': 'approvalFallback_noSession',
  'capture-empty': 'approvalFallback_captureEmpty',
  'capture-failed': 'approvalFallback_captureFailed',
  'parse-empty': 'approvalFallback_parseEmpty',
  'send-failed': 'approvalFallback_sendFailed',
  'request-failed': 'approvalFallback_requestFailed',
};

const APPROVAL_PUSH_TYPE_LABELS: Record<TApprovalPromptType, string> = {
  command: 'Command approval',
  file: 'File approval',
  permission: 'Permission approval',
  'resume-directory': 'Directory approval',
  conversation: 'Conversation choice',
  unknown: 'Input required',
};

export const cleanApprovalOptionLabel = (label: string): string =>
  label.replace(/^\d+\.\s+/, '').trim();

export const hasUsableApprovalOptions = (options: string[]): boolean =>
  options.some((option) => option.trim().length > 0);

export const shouldRetryApprovalOptions = ({
  options,
  attempt,
  maxAttempts,
}: {
  options: string[];
  attempt: number;
  maxAttempts: number;
}): boolean => !hasUsableApprovalOptions(options) && attempt < maxAttempts - 1;

export const getApprovalQueueFallbackText = (input: {
  lastUserMessage?: string | null;
  tabName: string;
}): string => {
  const prompt = input.lastUserMessage?.trim();
  return prompt || input.tabName;
};

export const getApprovalPromptTypeKey = (type: TApprovalPromptType | string): string =>
  APPROVAL_PROMPT_TYPE_KEYS[type as TApprovalPromptType] ?? APPROVAL_PROMPT_TYPE_KEYS.unknown;

export const getApprovalRiskKey = (risk: TApprovalRiskLevel | string): string =>
  APPROVAL_RISK_KEYS[risk as TApprovalRiskLevel] ?? APPROVAL_RISK_KEYS.unknown;

export const getApprovalFallbackKey = (reason: TApprovalFallbackReason | string): string =>
  APPROVAL_FALLBACK_KEYS[reason as TApprovalFallbackReason] ?? APPROVAL_FALLBACK_KEYS['request-failed'];

export const getApprovalMetadataDetail = (metadata: IApprovalPromptMetadata | null): string | null => {
  const commandPreview = metadata?.commandPreview?.trim();
  if (commandPreview) return commandPreview;

  const fileHints = metadata?.fileHints ?? [];
  if (fileHints.length === 0) return null;

  const visibleHints = fileHints.slice(0, 3).join(', ');
  const remainingCount = fileHints.length - 3;
  return remainingCount > 0 ? `${visibleHints} +${remainingCount}` : visibleHints;
};

export const buildApprovalPushBody = ({
  metadata,
  fallbackText,
  maxLength = 120,
}: {
  metadata: IApprovalPromptMetadata | null;
  fallbackText: string;
  maxLength?: number;
}): string => {
  const fallback = fallbackText.trim();
  if (!metadata || metadata.promptType === 'unknown') return fallback.slice(0, maxLength);

  const detail = getApprovalMetadataDetail(metadata);
  const parts = [
    APPROVAL_PUSH_TYPE_LABELS[metadata.promptType],
    metadata.riskLevel !== 'unknown' ? metadata.riskLevel : null,
    detail,
  ].filter((part): part is string => !!part && part.trim().length > 0);

  const body = parts.join(' · ');
  return (body || fallback).slice(0, maxLength);
};
