import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import TimelineView from '@/components/features/timeline/timeline-view';
import type { ITimelineEntry } from '@/types/timeline';

const messages = {
  common: {
    retry: '재시도',
  },
  timeline: {
    connectionError: '연결 오류',
    connectionFailed: '연결 실패',
    emptyRunning: '메시지를 입력하면 타임라인이 표시됩니다',
    loadMore: '이전 내용 더보기',
    reconnecting: '다시 연결 중',
    requestCancelled: '요청이 취소되었습니다',
    sessionExit: '세션 종료',
    timelineAria: 'Codex 타임라인',
  },
};

const makeEntries = (count: number): ITimelineEntry[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `entry-${index}`,
    type: 'user-message',
    timestamp: 1_700_000_000_000 + index,
    text: `message-${index}`,
  }));

const IntlProvider = NextIntlClientProvider as React.ComponentType<{
  locale: string;
  messages: typeof messages;
  timeZone: string;
  children?: React.ReactNode;
}>;

const renderTimeline = (entries: ITimelineEntry[]): string =>
  renderToStaticMarkup(
    React.createElement(
      IntlProvider,
      { locale: 'ko', messages, timeZone: 'Asia/Seoul' },
      React.createElement(TimelineView, {
        entries,
        tasks: [],
        sessionId: 'session-a',
        sessionName: 'pt-session-a',
        cliState: 'idle',
        wsStatus: 'connected',
        isLoading: false,
        error: null,
        onRetry: () => undefined,
        onLoadMore: async () => undefined,
        hasMore: false,
      }),
    ),
  );

describe('TimelineView', () => {
  it('windows long timelines instead of rendering every row', () => {
    const markup = renderTimeline(makeEntries(260));

    expect(markup).toContain('data-timeline-window-spacer="before"');
    expect(markup).toContain('message-259');
    expect(markup).not.toContain('message-0');
  });

  it('keeps short timelines fully rendered', () => {
    const markup = renderTimeline(makeEntries(20));

    expect(markup).not.toContain('data-timeline-window-spacer="before"');
    expect(markup).toContain('message-0');
    expect(markup).toContain('message-19');
  });
});
