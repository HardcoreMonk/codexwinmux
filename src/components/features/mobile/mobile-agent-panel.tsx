import { useState, useCallback, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import Spinner from '@/components/ui/spinner';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import useTimeline from '@/hooks/use-timeline';
import useStartingPrompt from '@/hooks/use-starting-prompt';
import useSessionList from '@/hooks/use-session-list';
import useTabStore, { selectAgentInstalled, selectAgentProcess, selectSessionView } from '@/hooks/use-tab-store';
import useSessionMeta from '@/hooks/use-session-meta';
import useGitBranch from '@/hooks/use-git-branch';
import useGitStatus from '@/hooks/use-git-status';
import useTmuxInfo from '@/hooks/use-tmux-info';
import useMessageCounts from '@/hooks/use-message-counts';
import SessionListView from '@/components/features/workspace/session-list-view';
import SessionEmptyView from '@/components/features/workspace/session-empty-view';
import BypassPromptCard from '@/components/features/workspace/bypass-prompt-card';
import TimelineView from '@/components/features/timeline/timeline-view';
import WebInputBar from '@/components/features/workspace/web-input-bar';
import QuickPromptBar from '@/components/features/workspace/quick-prompt-bar';
import { MetaCompact } from '@/components/features/workspace/session-meta-content';
import MobileMetaSheet from './mobile-meta-sheet';
import useQuickPrompts from '@/hooks/use-quick-prompts';
import { isAgentPanelType } from '@/lib/panel-type';
import { getTimelineResumeErrorLocaleKey } from '@/lib/resume-error';
import { selectAgentSessionListRenderMode } from '@/lib/session-list-rendering';
import type { ISessionMeta, TCliState, TTimelineResumeErrorReason } from '@/types/timeline';
import type { TPanelType } from '@/types/terminal';

interface IMobileAgentPanelProps {
  tabId?: string;
  wsId?: string;
  sessionName: string;
  agentSessionId?: string | null;
  panelType?: TPanelType;
  cwd?: string;
  sendStdin: (data: string) => void;
  terminalWsConnected: boolean;
  focusTerminal: () => void;
  focusInputRef: React.MutableRefObject<(() => void) | undefined>;
  setInputValueRef: React.MutableRefObject<((v: string) => void) | undefined>;
  onCliStateChange: (state: TCliState) => void;
  onInputVisibleChange: (visible: boolean) => void;
  onRestartSession?: () => void;
  onNewSession?: () => void;
}

const MobileAgentPanel = ({
  tabId,
  wsId,
  sessionName,
  agentSessionId,
  panelType = 'codex',
  cwd,
  sendStdin,
  terminalWsConnected,
  focusTerminal,
  focusInputRef,
  setInputValueRef,
  onCliStateChange,
  onInputVisibleChange,
  onRestartSession,
  onNewSession,
}: IMobileAgentPanelProps) => {
  const t = useTranslations('terminal');
  const { prompts: quickPrompts } = useQuickPrompts();
  const [resumingSessionId, setResumingSessionId] = useState<string | null>(null);
  const [metaSheetOpen, setMetaSheetOpen] = useState(false);
  const scrollToBottomRef = useRef<(() => void) | undefined>(undefined);

  const agentProcess = useTabStore((s) => tabId ? selectAgentProcess(s.tabs, tabId) : null);
  const agentInstalled = useTabStore((s) => tabId ? selectAgentInstalled(s.tabs, tabId) : true);
  const storeCliState = useTabStore((s) => tabId ? s.tabs[tabId]?.cliState ?? 'inactive' : 'inactive');
  const compactingSince = useTabStore((s) => tabId ? s.tabs[tabId]?.compactingSince ?? null : null);
  const tabAgentSummary = useTabStore((s) => tabId ? s.tabs[tabId]?.agentSummary ?? null : null);
  const tabLastUserMessage = useTabStore((s) => tabId ? s.tabs[tabId]?.lastUserMessage ?? null : null);
  const isAgentPanel = isAgentPanelType(panelType);

  const handleResumeStarted = useCallback(() => {
    setResumingSessionId(null);
  }, []);

  const handleResumeBlocked = useCallback(
    (payload: { reason: string; processName?: string }) => {
      setResumingSessionId(null);
      toast.warning(t('resumeBlocked'), {
        description: payload.processName
          ? t('resumeBlockedProcess', { name: payload.processName })
          : undefined,
      });
    },
    [t],
  );

  const handleResumeError = useCallback((payload: { message: string; reason: TTimelineResumeErrorReason }) => {
    setResumingSessionId(null);
    toast.error(t('resumeFailed'), {
      description: t(getTimelineResumeErrorLocaleKey(payload.reason)),
    });
  }, [t]);

  const {
    entries,
    tasks,
    sessionId,
    jsonlPath,
    sessionSummary,
    initMeta,
    sessionStats,
    agentProcess: agentProcessFromTimeline,
    wsStatus,
    isLoading: isTimelineLoading,
    error: timelineError,
    loadMore: loadMoreTimeline,
    hasMore: timelineHasMore,
    retrySession,
    sendResume,
    openJsonlSession,
    addPendingUserMessage,
    removePendingUserMessage,
  } = useTimeline({
    sessionName,
    agentSessionId,
    panelType,
    enabled: !!sessionName,
    resumeCallbacks: {
      onResumeStarted: handleResumeStarted,
      onResumeBlocked: handleResumeBlocked,
      onResumeError: handleResumeError,
    },
    onSync: tabId ? (state) => {
      const checkedAt = Date.now();
      if (state.agentProcess !== null) {
        useTabStore.getState().setAgentProcess(tabId, state.agentProcess, checkedAt);
      }
      if (!state.agentInstalled) {
        useTabStore.getState().setAgentInstalled(tabId, false);
      }
      useTabStore.getState().setTimelineLoading(tabId, state.isLoading);
    } : undefined,
    getCliState: tabId ? () => useTabStore.getState().tabs[tabId]?.cliState : undefined,
  });

  const view = useTabStore((s) => tabId ? selectSessionView(s.tabs, tabId) : 'session-list' as const);

  const {
    sessions,
    total: sessionListTotal,
    hasMore: sessionListHasMore,
    isLoading: isSessionListLoading,
    isLoadingMore: isSessionListLoadingMore,
    error: sessionListError,
    refetch: refetchSessions,
    loadMore: loadMoreSessions,
  } = useSessionList({
    tmuxSession: sessionName,
    enabled: isAgentPanel && !!sessionName && view === 'session-list',
    cwd,
    panelType,
  });

  const prevAgentProcessRef = useRef(agentProcess);
  useEffect(() => {
    const prev = prevAgentProcessRef.current;
    prevAgentProcessRef.current = agentProcess;
    if (prev !== true && agentProcess === true && agentProcessFromTimeline !== true) {
      retrySession();
    }
  }, [agentProcess, agentProcessFromTimeline, retrySession]);

  const { meta } = useSessionMeta(entries, sessionSummary, initMeta, sessionStats, tabAgentSummary, tabLastUserMessage);
  const { branch, isLoading: isBranchLoading } = useGitBranch(sessionName);
  const { status: gitStatus } = useGitStatus(sessionName, metaSheetOpen);
  const tmuxInfo = useTmuxInfo(sessionName, metaSheetOpen);
  const messageCounts = useMessageCounts(jsonlPath, metaSheetOpen);
  const metaWithCounts = messageCounts
    ? { ...meta, userCount: messageCounts.userCount, assistantCount: messageCounts.assistantCount }
    : meta;

  const isInputVisible = view === 'timeline';

  const startingPromptOptions = useStartingPrompt(view === 'check', sessionName);

  useEffect(() => {
    onCliStateChange(storeCliState);
  }, [storeCliState, onCliStateChange]);

  useEffect(() => {
    onInputVisibleChange(isInputVisible);
  }, [isInputVisible, onInputVisibleChange]);

  const handleScrollToBottom = useCallback(() => {
    if (storeCliState !== 'idle') return;
    scrollToBottomRef.current?.();
  }, [storeCliState]);

  const handleSelectQuickPrompt = useCallback((prompt: string) => {
    setInputValueRef.current?.(prompt);
    focusInputRef.current?.();
  }, [setInputValueRef, focusInputRef]);

  const handleSelectSession = useCallback(
    (session: ISessionMeta) => {
      if (resumingSessionId) return;
      setResumingSessionId(session.sessionId);
      if (session.jsonlPath) {
        if (openJsonlSession(session.jsonlPath, session.sessionId)) {
          if (tabId) {
            useTabStore.getState().setSessionView(tabId, 'timeline');
          }
        } else {
          retrySession();
        }
        setResumingSessionId(null);
        return;
      }
      sendResume(session.sessionId, sessionName);
    },
    [openJsonlSession, resumingSessionId, retrySession, sendResume, sessionName, tabId],
  );

  const handleRefreshSessions = useCallback(async () => {
    await refetchSessions();
  }, [refetchSessions]);

  if (!agentInstalled) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 bg-muted text-muted-foreground">
        <span className="text-sm font-medium">{t('installCodex')}</span>
        <span className="text-xs">{t('installCodexHint')}</span>
      </div>
    );
  }

  if (agentProcess === null && view !== 'check' && view !== 'session-list') {
    return (
      <div className="animate-delayed-fade-in flex min-h-0 flex-1 flex-col items-center justify-center bg-muted">
        <Spinner className="h-4 w-4 text-muted-foreground" />
      </div>
    );
  }

  if (view === 'check') {
    return (
      <div className="animate-delayed-fade-in flex min-h-0 flex-1 flex-col items-center justify-center bg-muted">
        <Spinner className="h-4 w-4 text-muted-foreground" />
        <span className="mt-2 text-sm text-muted-foreground">{(agentSessionId || sessionId) ? t('resumingSession') : t('creatingConversation')}</span>
        {startingPromptOptions && (
          startingPromptOptions.isBypassPrompt && startingPromptOptions.options.length > 0 ? (
            <BypassPromptCard
              sessionName={sessionName}
              options={startingPromptOptions.options}
              fallback={
                <span className="text-xs text-muted-foreground">{t('checkTerminal')}</span>
              }
            />
          ) : (
            <span className="mt-3 text-xs text-muted-foreground">{t('checkTerminal')}</span>
          )
        )}
      </div>
    );
  }

  if (view === 'session-list') {
    const renderMode = selectAgentSessionListRenderMode({
      isAgentPanel,
      isLoading: isSessionListLoading,
      sessionCount: sessions.length,
    });

    if (renderMode === 'empty') {
      return (
        <div className="flex min-h-0 flex-1 flex-col bg-muted">
          <SessionEmptyView onNewSession={onNewSession} />
        </div>
      );
    }
    if (renderMode === 'spinner') {
      return (
        <div className="animate-delayed-fade-in flex min-h-0 flex-1 flex-col items-center justify-center bg-muted">
          <Spinner className="h-4 w-4 text-muted-foreground" />
        </div>
      );
    }
    return (
      <div className="flex min-h-0 flex-1 flex-col bg-muted">
        <SessionListView
          sessions={sessions}
          total={sessionListTotal}
          isLoading={isSessionListLoading}
          isLoadingMore={isSessionListLoadingMore}
          hasMore={sessionListHasMore}
          error={sessionListError}
          resumingSessionId={resumingSessionId}
          onSelectSession={handleSelectSession}
          onRefresh={handleRefreshSessions}
          onLoadMore={loadMoreSessions}
          onNewSession={onNewSession}
          emptyView={<SessionEmptyView onNewSession={onNewSession} />}
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-muted">
      <div
        className="flex shrink-0 cursor-pointer items-center justify-between border-b px-4 py-1.5 hover:bg-muted/30"
        role="button"
        tabIndex={0}
        onClick={() => setMetaSheetOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setMetaSheetOpen(true);
          }
        }}
      >
        <MetaCompact
          title={meta.title}
          totalCost={meta.totalCost}
          branch={branch}
          usedPercentage={meta.usedPercentage}
          currentContextTokens={meta.currentContextTokens}
          contextWindowSize={meta.contextWindowSize}
        />
        <ChevronDown
          size={14}
          className="shrink-0 text-muted-foreground"
        />
      </div>

      <div className="min-h-0 flex-1">
        <TimelineView
          entries={entries}
          tasks={tasks}
          sessionId={sessionId}
          sessionName={sessionName}
          tabId={tabId}
          initMeta={initMeta}
          sessionStats={sessionStats}
          cliState={storeCliState}
          compactingSince={compactingSince}
          wsStatus={wsStatus}
          isLoading={isTimelineLoading}
          error={timelineError}
          onRetry={retrySession}
          onLoadMore={loadMoreTimeline}
          hasMore={timelineHasMore}
          scrollToBottomRef={scrollToBottomRef}
        />
      </div>

      <div className="shrink-0 pb-3">
        <WebInputBar
          tabId={tabId}
          wsId={wsId}
          sessionName={sessionName}
          agentSessionId={agentSessionId}
          cliState={storeCliState}
          sendStdin={sendStdin}
          terminalWsConnected={terminalWsConnected}
          visible={isInputVisible}
          focusTerminal={focusTerminal}
          focusInputRef={focusInputRef}
          setInputValueRef={setInputValueRef}
          maxRows={3}
          onRestartSession={onRestartSession}
          onSend={handleScrollToBottom}
          onOptimisticSend={addPendingUserMessage}
          onAddPendingMessage={addPendingUserMessage}
          onRemovePendingMessage={removePendingUserMessage}
        />
        <QuickPromptBar
          prompts={quickPrompts}
          visible={isInputVisible}
          onSelect={handleSelectQuickPrompt}
        />
      </div>

      <MobileMetaSheet
        open={metaSheetOpen}
        onOpenChange={setMetaSheetOpen}
        meta={metaWithCounts}
        toolCount={messageCounts?.toolCount ?? null}
        toolBreakdown={messageCounts?.toolBreakdown ?? null}
        branch={branch}
        isBranchLoading={isBranchLoading}
        sessionId={sessionId}
        gitStatus={gitStatus}
        tmuxInfo={tmuxInfo}
      />
    </div>
  );
};

export default MobileAgentPanel;
