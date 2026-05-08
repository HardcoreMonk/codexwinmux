import type { IAgentProvider } from '@/lib/providers';

export const isTimelineResumeSessionIdValid = (
  provider: Pick<IAgentProvider, 'isValidSessionId'>,
  sessionId: unknown,
): boolean => provider.isValidSessionId(sessionId);
