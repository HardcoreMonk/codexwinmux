import { describe, expect, it } from 'vitest';

import enNotification from '@/../messages/en/notification.json';
import koNotification from '@/../messages/ko/notification.json';
import {
  buildApprovalPushBody,
  cleanApprovalOptionLabel,
  getApprovalFallbackKey,
  getApprovalMetadataDetail,
  getApprovalQueueFallbackText,
  getApprovalPromptTypeKey,
  getApprovalRiskKey,
  hasUsableApprovalOptions,
  shouldRetryApprovalOptions,
} from '@/lib/approval-queue';
import type { IApprovalPromptMetadata } from '@/lib/permission-prompt';

describe('approval queue helpers', () => {
  it('removes numeric option prefixes from permission labels', () => {
    expect(cleanApprovalOptionLabel('1. Yes, allow it')).toBe('Yes, allow it');
    expect(cleanApprovalOptionLabel('No')).toBe('No');
  });

  it('detects non-empty option lists', () => {
    expect(hasUsableApprovalOptions(['1. Yes'])).toBe(true);
    expect(hasUsableApprovalOptions(['', '   '])).toBe(false);
    expect(hasUsableApprovalOptions([])).toBe(false);
  });

  it('retries empty option fetches before the final attempt', () => {
    expect(shouldRetryApprovalOptions({ options: [], attempt: 0, maxAttempts: 3 })).toBe(true);
    expect(shouldRetryApprovalOptions({ options: ['1. Yes'], attempt: 0, maxAttempts: 3 })).toBe(false);
    expect(shouldRetryApprovalOptions({ options: [], attempt: 2, maxAttempts: 3 })).toBe(false);
  });

  it('uses last prompt text before falling back to tab name', () => {
    expect(getApprovalQueueFallbackText({ lastUserMessage: 'Run tests?', tabName: 'codex' })).toBe('Run tests?');
    expect(getApprovalQueueFallbackText({ lastUserMessage: null, tabName: 'codex' })).toBe('codex');
  });

  it('maps prompt types to notification locale keys', () => {
    expect(getApprovalPromptTypeKey('command')).toBe('approvalType_command');
    expect(getApprovalPromptTypeKey('file')).toBe('approvalType_file');
    expect(getApprovalPromptTypeKey('permission')).toBe('approvalType_permission');
    expect(getApprovalPromptTypeKey('resume-directory')).toBe('approvalType_resumeDirectory');
    expect(getApprovalPromptTypeKey('conversation')).toBe('approvalType_conversation');
    expect(getApprovalPromptTypeKey('unknown')).toBe('approvalType_unknown');
    expect(getApprovalPromptTypeKey('future-type')).toBe('approvalType_unknown');
  });

  it('maps risk levels to notification locale keys', () => {
    expect(getApprovalRiskKey('high')).toBe('approvalRisk_high');
    expect(getApprovalRiskKey('medium')).toBe('approvalRisk_medium');
    expect(getApprovalRiskKey('low')).toBe('approvalRisk_low');
    expect(getApprovalRiskKey('unknown')).toBe('approvalRisk_unknown');
    expect(getApprovalRiskKey('future-risk')).toBe('approvalRisk_unknown');
  });

  it('maps fallback reasons to notification locale keys', () => {
    expect(getApprovalFallbackKey('no-session')).toBe('approvalFallback_noSession');
    expect(getApprovalFallbackKey('capture-empty')).toBe('approvalFallback_captureEmpty');
    expect(getApprovalFallbackKey('parse-empty')).toBe('approvalFallback_parseEmpty');
    expect(getApprovalFallbackKey('capture-failed')).toBe('approvalFallback_captureFailed');
    expect(getApprovalFallbackKey('send-failed')).toBe('approvalFallback_sendFailed');
    expect(getApprovalFallbackKey('request-failed')).toBe('approvalFallback_requestFailed');
    expect(getApprovalFallbackKey('future-fallback')).toBe('approvalFallback_requestFailed');
  });

  it('keeps mapped notification locale keys present in Korean and English', () => {
    const keys = [
      getApprovalPromptTypeKey('command'),
      getApprovalPromptTypeKey('file'),
      getApprovalPromptTypeKey('permission'),
      getApprovalPromptTypeKey('resume-directory'),
      getApprovalPromptTypeKey('conversation'),
      getApprovalPromptTypeKey('unknown'),
      getApprovalRiskKey('high'),
      getApprovalRiskKey('medium'),
      getApprovalRiskKey('low'),
      getApprovalRiskKey('unknown'),
      getApprovalFallbackKey('no-session'),
      getApprovalFallbackKey('capture-empty'),
      getApprovalFallbackKey('parse-empty'),
      getApprovalFallbackKey('capture-failed'),
      getApprovalFallbackKey('send-failed'),
      getApprovalFallbackKey('request-failed'),
    ];

    for (const key of keys) {
      expect(koNotification).toHaveProperty(key);
      expect(enNotification).toHaveProperty(key);
    }
  });

  it('returns concise metadata detail text', () => {
    const baseMetadata: IApprovalPromptMetadata = {
      promptType: 'unknown',
      approvalKind: 'unknown',
      riskLevel: 'unknown',
      commandPreview: null,
      fileHints: [],
      fallbackReason: null,
    };

    expect(getApprovalMetadataDetail({ ...baseMetadata, commandPreview: 'corepack pnpm test' })).toBe(
      'corepack pnpm test',
    );
    expect(getApprovalMetadataDetail({ ...baseMetadata, fileHints: ['a.ts', 'b.ts', 'c.ts', 'd.ts'] })).toBe(
      'a.ts, b.ts, c.ts +1',
    );
    expect(getApprovalMetadataDetail(null)).toBeNull();
    expect(getApprovalMetadataDetail({ ...baseMetadata, commandPreview: null, fileHints: [] })).toBeNull();
  });

  it('builds concise lock-screen copy from approval metadata', () => {
    const baseMetadata: IApprovalPromptMetadata = {
      promptType: 'command',
      approvalKind: 'allow',
      riskLevel: 'medium',
      commandPreview: 'corepack pnpm test',
      fileHints: [],
      fallbackReason: null,
    };

    expect(buildApprovalPushBody({ metadata: baseMetadata, fallbackText: 'Run tests?' })).toBe(
      'Command approval · medium · corepack pnpm test',
    );
    expect(buildApprovalPushBody({
      metadata: { ...baseMetadata, promptType: 'file', commandPreview: null, fileHints: ['server.ts', 'status.ts'] },
      fallbackText: 'Edit files?',
    })).toBe('File approval · medium · server.ts, status.ts');
    expect(buildApprovalPushBody({ metadata: null, fallbackText: 'Run tests?' })).toBe('Run tests?');
  });
});
