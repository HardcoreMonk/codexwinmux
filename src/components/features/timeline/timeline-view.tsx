import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { Terminal, RefreshCw, OctagonX, LogOut, ChevronsUp, MessageSquareMore } from 'lucide-react';
import Spinner from '@/components/ui/spinner';
import { useStickToBottom } from 'use-stick-to-bottom';
import { Button } from '@/components/ui/button';
import type {
  ITimelineEntry,
  ITimelineToolCall,
  ITimelineToolResult,
  ITaskItem,
  IInitMeta,
  ISessionStats,
  TCliState,
  TTimelineConnectionStatus,
} from '@/types/timeline';
import UserMessageItem from '@/components/features/timeline/user-message-item';
import AssistantMessageItem from '@/components/features/timeline/assistant-message-item';
import AgentGroupItem from '@/components/features/timeline/agent-group-item';
import TaskNotificationItem from '@/components/features/timeline/task-notification-item';
import ToolGroupItem from '@/components/features/timeline/tool-group-item';
import PlanItem from '@/components/features/timeline/plan-item';
import AskUserQuestionItem from '@/components/features/timeline/ask-user-question-item';
import TaskChecklist from '@/components/features/timeline/task-checklist';
import TaskProgressItem from '@/components/features/timeline/task-progress-item';
import ScrollToBottomButton from '@/components/features/timeline/scroll-to-bottom-button';
import PermissionPromptItem from '@/components/features/timeline/permission-prompt-item';
import { selectTimelineWindow } from '@/lib/timeline-window';

interface ITimelineViewProps {
  entries: ITimelineEntry[];
  tasks: ITaskItem[];
  sessionId: string | null;
  sessionName?: string;
  tabId?: string;
  initMeta?: IInitMeta;
  sessionStats?: ISessionStats | null;
  cliState: TCliState;
  compactingSince?: number | null;
  wsStatus: TTimelineConnectionStatus;
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
  onLoadMore: () => Promise<void>;
  hasMore: boolean;
  scrollToBottomRef?: React.MutableRefObject<(() => void) | undefined>;
}

const RESUME_TOKEN_THRESHOLD = 100_000;
const RESUME_IDLE_MINUTES = 70;
const ANCHOR_OFFSET = 12;
const ANCHOR_SETTLE_DELAY_MS = 300;
const OVERFLOW_SENTINEL_ROOT_MARGIN = '0px 0px 4px 0px';

const getOffsetInScroller = (el: HTMLElement, scrollEl: HTMLElement): number => {
  const elRect = el.getBoundingClientRect();
  const scrollRect = scrollEl.getBoundingClientRect();
  return elRect.top - scrollRect.top + scrollEl.scrollTop;
};

const ElapsedTime = ({ since }: { since: number }) => {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const update = () => setElapsed(Math.max(0, Math.floor((Date.now() - since) / 1000)));
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [since]);

  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const ss = String(elapsed % 60).padStart(2, '0');

  return <span className="tabular-nums">{mm}:{ss}</span>;
};

type TGroupedItem =
  | { type: 'entry'; id: string; entry: ITimelineEntry }
  | { type: 'tool-group'; id: string; toolCalls: ITimelineToolCall[]; toolResults: ITimelineToolResult[] };

interface IGroupedTimelineEntries {
  items: TGroupedItem[];
  lastUserMessageId: string | null;
}

const groupTimelineEntries = (entries: ITimelineEntry[]): IGroupedTimelineEntries => {
  const result: TGroupedItem[] = [];
  let toolCallBuffer: ITimelineToolCall[] = [];
  let toolResultBuffer: ITimelineToolResult[] = [];
  let lastUserMessageId: string | null = null;

  const flushToolBuffer = () => {
    if (toolCallBuffer.length > 0) {
      result.push({
        type: 'tool-group',
        id: toolCallBuffer[0].id,
        toolCalls: [...toolCallBuffer],
        toolResults: [...toolResultBuffer],
      });
      toolCallBuffer = [];
      toolResultBuffer = [];
    }
  };

  for (const entry of entries) {
    if (entry.type === 'tool-call') {
      toolCallBuffer.push(entry);
    } else if (entry.type === 'tool-result') {
      toolResultBuffer.push(entry);
    } else {
      flushToolBuffer();
      if (entry.type === 'user-message') lastUserMessageId = entry.id;
      result.push({ type: 'entry', id: entry.id, entry });
    }
  }

  flushToolBuffer();
  return { items: result, lastUserMessageId };
};

const InterruptItem = () => {
  const t = useTranslations('timeline');
  return (
    <div className="flex items-center justify-end gap-1.5 py-1 text-xs text-muted-foreground/60">
      <OctagonX size={12} />
      <span>{t('requestCancelled')}</span>
    </div>
  );
};

const SessionExitItem = () => {
  const t = useTranslations('timeline');
  return (
    <div className="flex items-center justify-end gap-1.5 py-1 text-xs text-muted-foreground/60">
      <LogOut size={12} />
      <span>{t('sessionExit')}</span>
    </div>
  );
};

const TimelineEntryRenderer = memo(({ entry, sessionName }: { entry: ITimelineEntry; sessionName?: string }) => {
  switch (entry.type) {
    case 'user-message':
      return <UserMessageItem entry={entry} />;
    case 'assistant-message':
      return <AssistantMessageItem entry={entry} />;
    case 'agent-group':
      return <AgentGroupItem entry={entry} />;
    case 'task-notification':
      return <TaskNotificationItem entry={entry} />;
    case 'plan':
      return <PlanItem entry={entry} sessionName={sessionName} />;
    case 'ask-user-question':
      return <AskUserQuestionItem entry={entry} sessionName={sessionName} />;
    case 'task-progress':
      return <TaskProgressItem entry={entry} />;
    case 'interrupt':
      return <InterruptItem />;
    case 'session-exit':
      return <SessionExitItem />;
    default:
      return null;
  }
}, (prev, next) => prev.entry === next.entry && prev.sessionName === next.sessionName);

TimelineEntryRenderer.displayName = 'TimelineEntryRenderer';

interface ITimelineGroupedItemProps {
  item: TGroupedItem;
  anchorUserId: string | null;
  anchorElRef: React.MutableRefObject<HTMLDivElement | null>;
  sessionName?: string;
}

const sameItemRefs = <T,>(prev: T[], next: T[]): boolean =>
  prev.length === next.length && prev.every((item, index) => item === next[index]);

const sameGroupedItem = (prev: TGroupedItem, next: TGroupedItem): boolean => {
  if (prev.id !== next.id || prev.type !== next.type) return false;
  if (prev.type === 'entry' && next.type === 'entry') return prev.entry === next.entry;
  if (prev.type === 'tool-group' && next.type === 'tool-group') {
    return sameItemRefs(prev.toolCalls, next.toolCalls)
      && sameItemRefs(prev.toolResults, next.toolResults);
  }
  return false;
};

const TimelineGroupedItem = memo(({
  item,
  anchorUserId,
  anchorElRef,
  sessionName,
}: ITimelineGroupedItemProps) => {
  const isAnchor = item.id === anchorUserId;

  return (
    <div
      ref={isAnchor ? anchorElRef : undefined}
      className={`${isAnchor ? '' : 'timeline-row-visibility '}px-4 py-1.5`}
    >
      {item.type === 'tool-group' ? (
        <ToolGroupItem toolCalls={item.toolCalls} toolResults={item.toolResults} />
      ) : (
        <TimelineEntryRenderer entry={item.entry} sessionName={sessionName} />
      )}
    </div>
  );
}, (prev, next) => (
  prev.sessionName === next.sessionName
  && (prev.item.id === prev.anchorUserId) === (next.item.id === next.anchorUserId)
  && sameGroupedItem(prev.item, next.item)
));

TimelineGroupedItem.displayName = 'TimelineGroupedItem';

const SkeletonLoader = () => (
  <div className="mx-auto max-w-content">
    <div className="animate-delayed-fade-in flex flex-col gap-4 p-4">
      {[48, 36, 40].map((w, i) => (
        <div key={i} className="flex flex-col gap-2">
          <div className="h-4 animate-pulse rounded bg-agent-active/20" style={{ width: `${w}%` }} />
          <div className="h-4 animate-pulse rounded bg-agent-active/20" style={{ width: `${w - 10}%` }} />
        </div>
      ))}
    </div>
  </div>
);

const ErrorState = ({ error, onRetry }: { error: string; onRetry: () => void }) => {
  const t = useTranslations('timeline');
  const tc = useTranslations('common');
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
      <Terminal size={32} className="opacity-40" />
      <div className="text-center">
        <p className="text-sm font-medium">{t('connectionError')}</p>
        <p className="mt-1 text-xs">{error}</p>
      </div>
      <Button variant="outline" size="xs" onClick={onRetry}>
        <RefreshCw size={12} />
        {tc('retry')}
      </Button>
    </div>
  );
};

const ReconnectBanner = () => {
  const t = useTranslations('timeline');
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 z-10 flex justify-center">
      <div className="pointer-events-auto flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground shadow-sm">
        <Spinner size={10} />
        {t('reconnecting')}
      </div>
    </div>
  );
};

const DisconnectedBanner = ({ onRetry }: { onRetry: () => void }) => {
  const t = useTranslations('timeline');
  const tc = useTranslations('common');
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 z-10 flex justify-center">
      <div className="pointer-events-auto flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground shadow-sm">
        <span>{t('connectionFailed')}</span>
        <Button variant="outline" size="xs" className="h-5 rounded-full px-2 text-xs" onClick={onRetry}>
          {tc('retry')}
        </Button>
      </div>
    </div>
  );
};

const EmptyState = () => {
  const t = useTranslations('timeline');

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
      <MessageSquareMore size={32} className="opacity-40" />
      <p className="text-xs">{t('emptyRunning')}</p>
    </div>
  );
};

const TimelineView = ({
  entries,
  tasks,
  sessionId,
  sessionName,
  tabId,
  initMeta,
  sessionStats,
  cliState,
  compactingSince,
  wsStatus,
  isLoading,
  error,
  onRetry,
  onLoadMore,
  hasMore,
  scrollToBottomRef,
}: ITimelineViewProps) => {
  const t = useTranslations('timeline');
  const needsInput = cliState === 'needs-input';
  const isCompacting = compactingSince != null && Date.now() - compactingSince < 60_000;
  const anchorElRef = useRef<HTMLDivElement | null>(null);
  const spacerRef = useRef<HTMLDivElement | null>(null);
  const bottomSentinelRef = useRef<HTMLDivElement | null>(null);
  const armedRef = useRef(false);
  const wasBusyRef = useRef(false);
  const pendingShrinkRef = useRef(false);
  const entryCountAtArmRef = useRef(-1);
  const { scrollRef, contentRef, scrollToBottom } = useStickToBottom({
    resize: { damping: 0.8, stiffness: 0.05 },
    initial: 'instant',
    targetScrollTop: (defaultTarget, { scrollElement }) => {
      const el = anchorElRef.current;
      if (!el) return defaultTarget;
      return getOffsetInScroller(el, scrollElement) - ANCHOR_OFFSET;
    },
  });
  const [anchorUserId, setAnchorUserId] = useState<string | null>(null);
  const [spacerHeight, setSpacerHeight] = useState(0);
  const [skipAnimation, setSkipAnimation] = useState(true);
  const [prevSessionId, setPrevSessionId] = useState(sessionId);
  const [hasOverflowBelow, setHasOverflowBelow] = useState(false);
  const [virtualViewport, setVirtualViewport] = useState({
    scrollTop: 0,
    viewportHeight: 0,
    stickToEnd: true,
  });

  if (prevSessionId !== sessionId) {
    setPrevSessionId(sessionId);
    setSkipAnimation(true);
    setAnchorUserId(null);
    setVirtualViewport({ scrollTop: 0, viewportHeight: 0, stickToEnd: true });
    armedRef.current = false;
    wasBusyRef.current = false;
    pendingShrinkRef.current = false;
  }

  useEffect(() => {
    if (!scrollToBottomRef) return;
    scrollToBottomRef.current = () => {
      armedRef.current = true;
      scrollToBottom('smooth');
      setTimeout(() => scrollToBottom('smooth'), ANCHOR_SETTLE_DELAY_MS);
    };
    return () => { scrollToBottomRef.current = undefined; };
  }, [scrollToBottomRef, scrollToBottom]);

  const groupedTimeline = useMemo(() => groupTimelineEntries(entries), [entries]);
  const groupedItems = groupedTimeline.items;
  const hasDisplayItems = groupedItems.length > 0;
  const lastUserMessageId = groupedTimeline.lastUserMessageId;
  const anchorIndex = anchorUserId ? groupedItems.findIndex((item) => item.id === anchorUserId) : -1;
  const timelineWindow = useMemo(() => selectTimelineWindow({
    itemCount: groupedItems.length,
    scrollTop: virtualViewport.scrollTop,
    viewportHeight: virtualViewport.viewportHeight,
    stickToEnd: virtualViewport.stickToEnd || skipAnimation,
    anchorIndex: anchorIndex >= 0 ? anchorIndex : undefined,
  }), [
    groupedItems.length,
    virtualViewport.scrollTop,
    virtualViewport.viewportHeight,
    virtualViewport.stickToEnd,
    skipAnimation,
    anchorIndex,
  ]);
  const visibleGroupedItems = useMemo(
    () => timelineWindow.enabled
      ? groupedItems.slice(timelineWindow.startIndex, timelineWindow.endIndex)
      : groupedItems,
    [groupedItems, timelineWindow.enabled, timelineWindow.startIndex, timelineWindow.endIndex],
  );

  useEffect(() => {
    if (armedRef.current && lastUserMessageId && lastUserMessageId !== anchorUserId) {
      setAnchorUserId(lastUserMessageId);
      armedRef.current = false;
    }
  }, [lastUserMessageId, anchorUserId]);

  const [shouldProbeResumeDialog, setShouldProbeResumeDialog] = useState(false);
  const currentContextTokens = sessionStats?.currentContextTokens ?? 0;
  const resumeProbeDepsKey = `${cliState}:${currentContextTokens}:${initMeta?.lastTimestamp ?? 0}:${sessionName ?? ''}`;

  useEffect(() => {
    if (cliState !== 'idle' || !initMeta || !sessionName
      || currentContextTokens < RESUME_TOKEN_THRESHOLD
      || !initMeta.lastTimestamp) {
      setShouldProbeResumeDialog(false);
      return;
    }

    const check = () => {
      const idleMinutes = (Date.now() - initMeta.lastTimestamp) / 60_000;
      setShouldProbeResumeDialog(idleMinutes >= RESUME_IDLE_MINUTES);
    };
    check();
    const id = setInterval(check, 60_000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeProbeDepsKey]);

  useEffect(() => {
    if (skipAnimation && entries.length > 0) {
      scrollToBottom('instant');
      requestAnimationFrame(() => setSkipAnimation(false));
    }
  }, [skipAnimation, entries.length, scrollToBottom]);

  const updateVirtualViewport = useCallback(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;
    const scrollTop = Math.max(0, scrollEl.scrollTop);
    const viewportHeight = Math.max(0, scrollEl.clientHeight);
    const distanceToBottom = Math.max(0, scrollEl.scrollHeight - viewportHeight - scrollTop);

    setVirtualViewport((prev) => {
      const stickToEnd = viewportHeight === 0 ? prev.stickToEnd : distanceToBottom < viewportHeight * 0.75;

      return prev.scrollTop === scrollTop
        && prev.viewportHeight === viewportHeight
        && prev.stickToEnd === stickToEnd
        ? prev
        : { scrollTop, viewportHeight, stickToEnd };
    });
  }, [scrollRef]);

  useLayoutEffect(() => {
    updateVirtualViewport();
  }, [groupedItems.length, updateVirtualViewport]);

  useEffect(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;

    updateVirtualViewport();
    scrollEl.addEventListener('scroll', updateVirtualViewport, { passive: true });

    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateVirtualViewport);
    ro?.observe(scrollEl);

    return () => {
      scrollEl.removeEventListener('scroll', updateVirtualViewport);
      ro?.disconnect();
    };
  }, [scrollRef, updateVirtualViewport]);

  const measureSpacer = useCallback(() => {
    const scrollEl = scrollRef.current;
    const userEl = anchorElRef.current;
    const spacerEl = spacerRef.current;
    if (!scrollEl || !userEl || !spacerEl) return;
    const userBottom = userEl.offsetTop + userEl.offsetHeight;
    const postUserHeight = Math.max(0, spacerEl.offsetTop - userBottom);
    const available = scrollEl.clientHeight - userEl.offsetHeight - ANCHOR_OFFSET;
    const next = Math.max(0, available - postUserHeight);
    setSpacerHeight((prev) => (prev === next ? prev : next));
  }, [scrollRef]);

  const shrinkSpacerSafely = useCallback(() => {
    const scrollEl = scrollRef.current;
    const userEl = anchorElRef.current;
    const spacerEl = spacerRef.current;
    if (!scrollEl || !userEl || !spacerEl) return;
    const current = spacerEl.offsetHeight;
    if (current === 0) return;
    const scrollTop = scrollEl.scrollTop;
    const userBottom = userEl.offsetTop + userEl.offsetHeight;
    const postUserHeight = Math.max(0, spacerEl.offsetTop - userBottom);
    const available = scrollEl.clientHeight - userEl.offsetHeight - ANCHOR_OFFSET;
    const pinRemainder = Math.max(0, available - postUserHeight);
    const pin = Math.max(0, getOffsetInScroller(userEl, scrollEl) - ANCHOR_OFFSET);
    const atPin = scrollTop >= pin - 2;
    const target = atPin ? pinRemainder : 0;
    if (current <= target) return;
    const maxScroll = scrollEl.scrollHeight - scrollEl.clientHeight;
    const headroom = Math.max(0, maxScroll - scrollTop);
    const shrinkBy = Math.min(current - target, headroom);
    if (shrinkBy <= 0) return;
    setSpacerHeight(current - shrinkBy);
  }, [scrollRef]);

  useLayoutEffect(() => {
    wasBusyRef.current = false;
    pendingShrinkRef.current = false;
    if (!anchorUserId) {
      setSpacerHeight(0);
      return;
    }
    measureSpacer();
  }, [anchorUserId, measureSpacer]);

  useEffect(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;
    const ro = new ResizeObserver(() => measureSpacer());
    ro.observe(scrollEl);
    return () => ro.disconnect();
  }, [scrollRef, measureSpacer]);

  useEffect(() => {
    if (!anchorUserId) return;
    if (cliState === 'busy') {
      wasBusyRef.current = true;
      pendingShrinkRef.current = false;
      return;
    }
    if (wasBusyRef.current) {
      wasBusyRef.current = false;
      pendingShrinkRef.current = true;
      entryCountAtArmRef.current = entries.length;
      return;
    }
    if (pendingShrinkRef.current && entries.length !== entryCountAtArmRef.current) {
      pendingShrinkRef.current = false;
      shrinkSpacerSafely();
    }
  }, [cliState, anchorUserId, entries.length, shrinkSpacerSafely]);

  const canObserveOverflow = !isLoading && !error && hasDisplayItems && !skipAnimation;
  useEffect(() => {
    if (!canObserveOverflow) return;
    const scrollEl = scrollRef.current;
    const sentinel = bottomSentinelRef.current;
    if (!scrollEl || !sentinel) return;

    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setHasOverflowBelow(false);
          return;
        }
        const root = entry.rootBounds;
        const target = entry.boundingClientRect;
        setHasOverflowBelow(!!root && target.top >= root.bottom);
      },
      { root: scrollEl, threshold: 0, rootMargin: OVERFLOW_SENTINEL_ROOT_MARGIN },
    );
    io.observe(sentinel);
    return () => io.disconnect();
  }, [canObserveOverflow, scrollRef]);

  const isLoadingMoreRef = useRef(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const needsManualAnchor = typeof CSS !== 'undefined' && !CSS.supports?.('overflow-anchor', 'auto');
  const scrollAnchorRef = useRef<{ scrollHeight: number } | null>(null);

  const triggerLoadMore = useCallback(() => {
    if (!hasMore || isLoadingMoreRef.current) return;
    isLoadingMoreRef.current = true;
    setIsLoadingMore(true);

    if (needsManualAnchor) {
      const scrollEl = scrollRef.current;
      if (scrollEl) {
        scrollAnchorRef.current = { scrollHeight: scrollEl.scrollHeight };
      }
    }

    onLoadMore().finally(() => {
      isLoadingMoreRef.current = false;
      setIsLoadingMore(false);
    });
  }, [hasMore, onLoadMore, scrollRef, needsManualAnchor]);

  useLayoutEffect(() => {
    if (!needsManualAnchor) return;

    const anchor = scrollAnchorRef.current;
    const scrollEl = scrollRef.current;
    if (!anchor || !scrollEl || isLoadingMore) return;

    const heightDiff = scrollEl.scrollHeight - anchor.scrollHeight;
    if (heightDiff > 0) {
      scrollEl.scrollTop += heightDiff;
    }
    scrollAnchorRef.current = null;
  }, [isLoadingMore, scrollRef, needsManualAnchor]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    const root = scrollRef.current;
    if (!sentinel || !root) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          triggerLoadMore();
        }
      },
      { root, rootMargin: '200px 0px 0px 0px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [scrollRef, triggerLoadMore]);

  if (isLoading) {
    return <SkeletonLoader />;
  }

  if (error) {
    return <ErrorState error={error} onRetry={onRetry} />;
  }

  if (!hasDisplayItems) {
    return <EmptyState />;
  }

  const isReconnecting = wsStatus === 'reconnecting';
  const isDisconnected = wsStatus === 'disconnected';

  return (
    <div className="relative flex h-full flex-col">
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto py-2 transition-opacity"
        style={{
          opacity: skipAnimation ? 0 : 1,
          transitionDuration: '300ms',
        }}
        tabIndex={0}
        role="log"
        aria-label={t('timelineAria')}
      >
        <div ref={contentRef} className="mx-auto max-w-content">
          {hasMore && <div ref={sentinelRef} className="h-px" />}
          {hasMore && !isLoadingMore && (
            <div className="flex justify-center py-2">
              <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={triggerLoadMore}>
                <ChevronsUp size={12} className="mr-1" />
                {t('loadMore')}
              </Button>
            </div>
          )}
          {isLoadingMore && (
            <div className="flex flex-col gap-3 px-4 py-3">
              {[44, 32, 48].map((w, i) => (
                <div key={i} className="flex flex-col gap-1.5">
                  <div className="h-3.5 animate-pulse rounded bg-muted/60" style={{ width: `${w}%` }} />
                  <div className="h-3.5 animate-pulse rounded bg-muted/60" style={{ width: `${w - 12}%` }} />
                </div>
              ))}
            </div>
          )}
          {tasks.length > 0 && (
            <TaskChecklist tasks={tasks} cliState={cliState} />
          )}
          {timelineWindow.enabled && timelineWindow.beforeHeight > 0 && (
            <div
              aria-hidden
              data-timeline-window-spacer="before"
              style={{ height: timelineWindow.beforeHeight, overflowAnchor: 'none' }}
            />
          )}
          {visibleGroupedItems.map((item) => (
            <TimelineGroupedItem
              key={item.id}
              item={item}
              anchorUserId={anchorUserId}
              anchorElRef={anchorElRef}
              sessionName={sessionName}
            />
          ))}
          {timelineWindow.enabled && timelineWindow.afterHeight > 0 && (
            <div
              aria-hidden
              data-timeline-window-spacer="after"
              style={{ height: timelineWindow.afterHeight, overflowAnchor: 'none' }}
            />
          )}
          {(shouldProbeResumeDialog || needsInput) && sessionName && (
            <div className="px-4 py-1.5">
              <PermissionPromptItem
                sessionName={sessionName}
                tabId={tabId}
                silent={shouldProbeResumeDialog && !needsInput}
              />
            </div>
          )}
          {cliState === 'busy' && !needsInput && (
            <div className="flex items-center gap-2 px-4 py-3 text-xs text-muted-foreground">
              <Spinner size={10} className="text-agent-active" />
              <ElapsedTime since={entries[entries.length - 1].timestamp} />
            </div>
          )}
          {isCompacting && (
            <div className="flex items-center gap-2 px-4 py-3 text-xs text-muted-foreground">
              <Spinner size={10} className="text-agent-active" />
              <span>컨텍스트 압축 중…</span>
            </div>
          )}
          <div ref={bottomSentinelRef} aria-hidden style={{ height: 0, overflowAnchor: 'none' }} />
          {/* overflow-anchor: none prevents the browser from anchoring scroll to this spacer when its height changes */}
          <div ref={spacerRef} aria-hidden style={{ height: spacerHeight, overflowAnchor: 'none' }} />
        </div>
      </div>
      {isReconnecting && <ReconnectBanner />}
      {isDisconnected && <DisconnectedBanner onRetry={onRetry} />}
      <ScrollToBottomButton
        visible={hasOverflowBelow}
        onClick={() => {
          const el = scrollRef.current;
          if (!el) return;
          const spacerH = spacerRef.current?.offsetHeight ?? 0;
          el.scrollTo({ top: el.scrollHeight - spacerH, behavior: 'smooth' });
        }}
      />
    </div>
  );
};

export default TimelineView;
