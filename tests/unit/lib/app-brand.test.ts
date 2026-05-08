import { describe, expect, it } from 'vitest';
import { APP_DISPLAY_NAME, APP_PROCESS_NAME } from '@/lib/app-brand';

describe('app brand', () => {
  it('uses the Windows native display title without changing the process identity', () => {
    expect(APP_DISPLAY_NAME).toBe('windows native codexmux');
    expect(APP_PROCESS_NAME).toBe('codexmux');
  });
});
