import { describe, expect, it } from 'vitest';
import { APP_DISPLAY_NAME, APP_PROCESS_NAME } from '@/lib/app-brand';

describe('app brand', () => {
  it('uses the codexwinmux display title and process identity', () => {
    expect(APP_DISPLAY_NAME).toBe('codexwinmux');
    expect(APP_PROCESS_NAME).toBe('codexwinmux');
  });
});
