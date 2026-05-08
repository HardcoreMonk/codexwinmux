import { describe, expect, it } from 'vitest';
import {
  buildTimelineResumeErrorMessage,
  getTimelineResumeErrorLocaleKey,
} from '@/lib/resume-error';

describe('resume error classification', () => {
  it('maps stable resume error reasons to terminal locale keys', () => {
    expect(getTimelineResumeErrorLocaleKey('invalid-session-id')).toBe('resumeFailed_invalidSessionId');
    expect(getTimelineResumeErrorLocaleKey('command-build-failed')).toBe('resumeFailed_commandBuildFailed');
    expect(getTimelineResumeErrorLocaleKey('send-failed')).toBe('resumeFailed_sendFailed');
    expect(getTimelineResumeErrorLocaleKey('unknown')).toBe('resumeFailed_unknown');
    expect(getTimelineResumeErrorLocaleKey('future-reason')).toBe('resumeFailed_unknown');
    expect(getTimelineResumeErrorLocaleKey(undefined)).toBe('resumeFailed_unknown');
  });

  it('builds sanitized timeline resume error payloads', () => {
    expect(buildTimelineResumeErrorMessage('send-failed', new Error('C:\\Users\\yohan\\secret'))).toEqual({
      type: 'timeline:resume-error',
      reason: 'send-failed',
      message: 'Failed to send resume command',
    });
  });
});
