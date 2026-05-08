import type { ITimelineResumeErrorMessage, TTimelineResumeErrorReason } from '@/types/timeline';

const RESUME_ERROR_MESSAGES: Record<TTimelineResumeErrorReason, string> = {
  'invalid-session-id': 'Invalid session ID format',
  'command-build-failed': 'Failed to build resume command',
  'send-failed': 'Failed to send resume command',
  unknown: 'Error during resume',
};

const RESUME_ERROR_LOCALE_KEYS: Record<TTimelineResumeErrorReason, string> = {
  'invalid-session-id': 'resumeFailed_invalidSessionId',
  'command-build-failed': 'resumeFailed_commandBuildFailed',
  'send-failed': 'resumeFailed_sendFailed',
  unknown: 'resumeFailed_unknown',
};

const isTimelineResumeErrorReason = (reason: unknown): reason is TTimelineResumeErrorReason =>
  typeof reason === 'string' && reason in RESUME_ERROR_LOCALE_KEYS;

export const getTimelineResumeErrorLocaleKey = (reason: unknown): string =>
  isTimelineResumeErrorReason(reason)
    ? RESUME_ERROR_LOCALE_KEYS[reason]
    : RESUME_ERROR_LOCALE_KEYS.unknown;

export const buildTimelineResumeErrorMessage = (
  reason: TTimelineResumeErrorReason,
  err?: unknown,
): ITimelineResumeErrorMessage => {
  void err;
  return {
    type: 'timeline:resume-error',
    reason,
    message: RESUME_ERROR_MESSAGES[reason],
  };
};
