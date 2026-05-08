import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Loader2, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import Spinner from '@/components/ui/spinner';
import { ackNotificationInput } from '@/hooks/use-agent-status';
import {
  cleanApprovalOptionLabel,
  getApprovalFallbackKey,
  getApprovalMetadataDetail,
  getApprovalQueueFallbackText,
  getApprovalPromptTypeKey,
  getApprovalRiskKey,
  hasUsableApprovalOptions,
  shouldRetryApprovalOptions,
  type TApprovalFallbackReason,
} from '@/lib/approval-queue';
import type { IApprovalPromptMetadata } from '@/lib/permission-prompt';
import { cn } from '@/lib/utils';

type TApprovalPhase = 'loading' | 'ready' | 'failed';

interface IApprovalQueueItemProps {
  tabId: string;
  sessionName: string | null;
  workspaceId: string;
  workspaceName: string;
  tabName: string;
  lastUserMessage?: string | null;
  lastEventSeq?: number;
  isActiveTab?: boolean;
  onNavigate?: (workspaceId: string, tabId: string) => void;
}

interface IApprovalOptionsResponse {
  options: string[];
  metadata: IApprovalPromptMetadata | null;
  captureEmpty: boolean;
  fallbackReason: TApprovalFallbackReason | null;
}

interface IApprovalAuditPayload {
  eventType: 'options-ready' | 'fallback' | 'selection-sent' | 'selection-failed';
  workspaceId: string;
  tabId: string;
  promptType?: IApprovalPromptMetadata['promptType'];
  approvalKind?: IApprovalPromptMetadata['approvalKind'];
  riskLevel?: IApprovalPromptMetadata['riskLevel'];
  selectedOptionIndex?: number;
  optionCount?: number;
  fallbackReason?: TApprovalFallbackReason;
}

const approvalPromptTypes = new Set(['command', 'file', 'permission', 'resume-directory', 'conversation', 'unknown']);
const approvalKinds = new Set(['allow', 'deny', 'trust', 'directory', 'input', 'unknown']);
const approvalRiskLevels = new Set(['low', 'medium', 'high', 'unknown']);

const parseApprovalMetadata = (value: unknown): IApprovalPromptMetadata | null => {
  if (!value || typeof value !== 'object') return null;
  const metadata = value as Partial<IApprovalPromptMetadata>;
  if (!approvalPromptTypes.has(String(metadata.promptType))) return null;
  if (!approvalKinds.has(String(metadata.approvalKind))) return null;
  if (!approvalRiskLevels.has(String(metadata.riskLevel))) return null;
  if (metadata.commandPreview !== null && typeof metadata.commandPreview !== 'string') return null;
  if (!Array.isArray(metadata.fileHints) || !metadata.fileHints.every((hint) => typeof hint === 'string')) return null;
  if (metadata.fallbackReason !== null) return null;
  return metadata as IApprovalPromptMetadata;
};

const fetchPermissionOptions = async (sessionName: string): Promise<IApprovalOptionsResponse> => {
  const maxAttempts = 12;
  const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let options: string[] = [];
    let metadata: IApprovalPromptMetadata | null = null;
    let captureEmpty = false;
    let requestFailed = false;

    try {
      const res = await fetch(`/api/tmux/permission-options?session=${encodeURIComponent(sessionName)}`);
      if (res.ok) {
        const data = await res.json() as {
          options?: unknown;
          metadata?: unknown;
          captureEmpty?: unknown;
          captureFailed?: unknown;
          fallbackReason?: unknown;
        };
        options = Array.isArray(data.options) ? data.options.filter((option): option is string => typeof option === 'string') : [];
        metadata = parseApprovalMetadata(data.metadata);
        captureEmpty = data.captureEmpty === true;
        const fallbackReason = typeof data.fallbackReason === 'string'
          ? data.fallbackReason as TApprovalFallbackReason
          : null;
        if (fallbackReason) {
          return {
            options,
            metadata,
            captureEmpty,
            fallbackReason,
          };
        }
        if (data.captureFailed === true) requestFailed = true;
      } else {
        requestFailed = true;
      }
    } catch {
      options = [];
      requestFailed = true;
    }

    if (!shouldRetryApprovalOptions({ options, attempt, maxAttempts })) {
      return {
        options,
        metadata,
        captureEmpty,
        fallbackReason: hasUsableApprovalOptions(options)
          ? null
          : requestFailed
            ? 'request-failed'
            : captureEmpty
              ? 'capture-empty'
              : 'parse-empty',
      };
    }
    await delay(300);
  }

  return { options: [], metadata: null, captureEmpty: false, fallbackReason: 'parse-empty' };
};

const sendSelection = async (sessionName: string, optionIndex: number): Promise<boolean> => {
  try {
    const res = await fetch('/api/tmux/send-input', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session: sessionName, input: String(optionIndex + 1) }),
    });
    return res.ok;
  } catch {
    return false;
  }
};

const recordApprovalAuditEvent = (payload: IApprovalAuditPayload): void => {
  fetch('/api/approval/audit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    keepalive: true,
  }).catch(() => {});
};

const getApprovalAuditMetadata = (metadata: IApprovalPromptMetadata | null) => ({
  promptType: metadata?.promptType ?? 'unknown',
  approvalKind: metadata?.approvalKind ?? 'unknown',
  riskLevel: metadata?.riskLevel ?? 'unknown',
});

const ApprovalQueueItem = ({
  tabId,
  sessionName,
  workspaceId,
  workspaceName,
  tabName,
  lastUserMessage,
  lastEventSeq,
  isActiveTab,
  onNavigate,
}: IApprovalQueueItemProps) => {
  const t = useTranslations('notification');
  const [phase, setPhase] = useState<TApprovalPhase>('loading');
  const [options, setOptions] = useState<string[]>([]);
  const [metadata, setMetadata] = useState<IApprovalPromptMetadata | null>(null);
  const [fallbackReason, setFallbackReason] = useState<TApprovalFallbackReason | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 새 notification event가 들어오면 이전 선택 상태를 즉시 버려야 한다.
    setPhase('loading');
    setOptions([]);
    setMetadata(null);
    setFallbackReason(null);
    setSelectedIndex(null);
    setSent(false);

    if (!sessionName) {
      setFallbackReason('no-session');
      setPhase('failed');
      recordApprovalAuditEvent({
        eventType: 'fallback',
        workspaceId,
        tabId,
        fallbackReason: 'no-session',
      });
      return () => { cancelled = true; };
    }

    fetchPermissionOptions(sessionName)
      .then((result) => {
        if (cancelled) return;
        if (!hasUsableApprovalOptions(result.options)) {
          setMetadata(null);
          setFallbackReason(result.fallbackReason);
          setPhase('failed');
          recordApprovalAuditEvent({
            eventType: 'fallback',
            workspaceId,
            tabId,
            fallbackReason: result.fallbackReason ?? 'parse-empty',
          });
          return;
        }
        setMetadata(result.metadata);
        setOptions(result.options);
        setPhase('ready');
        recordApprovalAuditEvent({
          eventType: 'options-ready',
          workspaceId,
          tabId,
          ...getApprovalAuditMetadata(result.metadata),
          optionCount: result.options.length,
        });
      })
      .catch(() => {
        if (!cancelled) {
          setFallbackReason('request-failed');
          setPhase('failed');
          recordApprovalAuditEvent({
            eventType: 'fallback',
            workspaceId,
            tabId,
            fallbackReason: 'request-failed',
          });
        }
      });

    return () => { cancelled = true; };
  }, [sessionName, lastEventSeq, workspaceId, tabId]);

  const promptText = useMemo(
    () => getApprovalQueueFallbackText({ lastUserMessage, tabName }),
    [lastUserMessage, tabName],
  );
  const metadataDetail = useMemo(() => getApprovalMetadataDetail(metadata), [metadata]);

  const handleNavigate = useCallback(() => {
    onNavigate?.(workspaceId, tabId);
  }, [onNavigate, workspaceId, tabId]);

  const handleSelect = useCallback(
    async (idx: number) => {
      if (!sessionName || selectedIndex !== null || sent) return;

      setSelectedIndex(idx);
      const ok = await sendSelection(sessionName, idx);
      if (!ok) {
        setSelectedIndex(null);
        setFallbackReason('send-failed');
        recordApprovalAuditEvent({
          eventType: 'selection-failed',
          workspaceId,
          tabId,
          ...getApprovalAuditMetadata(metadata),
          selectedOptionIndex: idx,
          optionCount: options.length,
          fallbackReason: 'send-failed',
        });
        toast.error(t(getApprovalFallbackKey('send-failed')));
        return;
      }
      recordApprovalAuditEvent({
        eventType: 'selection-sent',
        workspaceId,
        tabId,
        ...getApprovalAuditMetadata(metadata),
        selectedOptionIndex: idx,
        optionCount: options.length,
      });
      if (lastEventSeq !== undefined) {
        ackNotificationInput(tabId, lastEventSeq);
      }
      setSent(true);
    },
    [sessionName, selectedIndex, sent, lastEventSeq, tabId, t, workspaceId, metadata, options.length],
  );

  return (
    <div
      className={cn(
        'rounded-md border border-border/70 px-3 py-2.5',
        isActiveTab ? 'bg-agent-active/10' : 'bg-background',
      )}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-xs text-muted-foreground">{workspaceName}</p>
          <p className={cn('truncate text-sm', isActiveTab ? 'text-foreground' : 'text-muted-foreground')}>
            {promptText}
          </p>
          {metadata && (
            <div className="mt-1 flex min-w-0 items-center gap-1.5">
              <span className="rounded border border-border/60 bg-muted/40 px-1.5 py-0.5 text-[11px] leading-none text-muted-foreground">
                {t(getApprovalPromptTypeKey(metadata.promptType))}
              </span>
              <span
                className={cn(
                  'rounded border px-1.5 py-0.5 text-[11px] leading-none',
                  metadata.riskLevel === 'high' && 'border-destructive/30 bg-destructive/10 text-destructive',
                  metadata.riskLevel === 'medium' && 'border-ui-amber/35 bg-ui-amber/10 text-ui-amber',
                  (metadata.riskLevel === 'low' || metadata.riskLevel === 'unknown')
                    && 'border-border/60 bg-muted/40 text-muted-foreground',
                )}
              >
                {t(getApprovalRiskKey(metadata.riskLevel))}
              </span>
              {metadataDetail && (
                <span className="min-w-0 truncate font-mono text-[11px] leading-none text-muted-foreground">
                  {metadataDetail}
                </span>
              )}
            </div>
          )}
        </div>
        {sent && <Check className="h-4 w-4 shrink-0 text-agent-active" />}
      </div>

      {phase === 'loading' && (
        <div className="flex items-center gap-2 rounded border border-agent-active/20 bg-agent-active/5 px-2.5 py-2 text-xs text-agent-active">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          <span className="truncate">{t('approvalLoading')}</span>
        </div>
      )}

      {phase === 'failed' && (
        <div className="flex items-center justify-between gap-2 rounded border border-ui-amber/30 bg-ui-amber/5 px-2.5 py-2">
          <span className="inline-flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-ui-amber" />
            <span className="truncate">{t(getApprovalFallbackKey(fallbackReason ?? 'request-failed'))}</span>
          </span>
          {!isActiveTab && (
            <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={handleNavigate}>
              {t('navigate')}
            </Button>
          )}
        </div>
      )}

      {phase === 'ready' && (
        <div className="flex flex-col gap-1.5">
          {options.map((option, idx) => {
            const selected = selectedIndex === idx;
            const disabled = selectedIndex !== null || sent;

            return (
              <button
                key={`${idx}-${option}`}
                type="button"
                disabled={disabled}
                onClick={() => handleSelect(idx)}
                className={cn(
                  'flex min-h-9 items-center gap-2 rounded border border-border/60 px-2.5 py-1.5 text-left text-sm transition-colors',
                  selected
                    ? 'border-agent-active/50 bg-agent-active/10'
                    : 'hover:border-agent-active/30 hover:bg-agent-active/5',
                  disabled && !selected && 'opacity-50',
                )}
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-muted text-xs text-muted-foreground">
                  {selected && !sent ? <Spinner size={10} /> : idx + 1}
                </span>
                <span className="min-w-0 truncate">{cleanApprovalOptionLabel(option)}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ApprovalQueueItem;
