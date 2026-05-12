import { describe, expect, it } from 'vitest';
import { selectTimelineWindow } from '@/lib/timeline-window';

describe('timeline window selection', () => {
  it('keeps short timelines unwindowed', () => {
    expect(selectTimelineWindow({
      itemCount: 20,
      scrollTop: 0,
      viewportHeight: 720,
    })).toEqual({
      enabled: false,
      startIndex: 0,
      endIndex: 20,
      beforeHeight: 0,
      afterHeight: 0,
    });
  });

  it('renders the tail window for long timelines while preserving estimated scroll height', () => {
    const window = selectTimelineWindow({
      itemCount: 500,
      scrollTop: 0,
      viewportHeight: 720,
      stickToEnd: true,
    });

    expect(window.enabled).toBe(true);
    expect(window.startIndex).toBeGreaterThan(0);
    expect(window.endIndex).toBe(500);
    expect(window.endIndex - window.startIndex).toBeLessThan(500);
    expect(window.beforeHeight).toBeGreaterThan(0);
    expect(window.afterHeight).toBe(0);
  });

  it('moves the window through the middle of a long timeline', () => {
    const window = selectTimelineWindow({
      itemCount: 500,
      scrollTop: 128 * 250,
      viewportHeight: 768,
    });

    expect(window.enabled).toBe(true);
    expect(window.startIndex).toBeLessThanOrEqual(250);
    expect(window.endIndex).toBeGreaterThan(250);
    expect(window.beforeHeight).toBeGreaterThan(0);
    expect(window.afterHeight).toBeGreaterThan(0);
  });

  it('keeps the requested anchor inside the rendered range', () => {
    const window = selectTimelineWindow({
      itemCount: 500,
      scrollTop: 0,
      viewportHeight: 720,
      anchorIndex: 110,
      stickToEnd: true,
    });

    expect(window.enabled).toBe(true);
    expect(window.startIndex).toBeLessThanOrEqual(110);
    expect(window.endIndex).toBeGreaterThan(110);
  });
});
