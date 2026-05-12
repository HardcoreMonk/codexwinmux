export interface ISelectTimelineWindowInput {
  itemCount: number;
  scrollTop: number;
  viewportHeight: number;
  anchorIndex?: number;
  stickToEnd?: boolean;
  estimatedRowHeight?: number;
  threshold?: number;
  minRows?: number;
  overscanRows?: number;
}

export interface ITimelineWindow {
  enabled: boolean;
  startIndex: number;
  endIndex: number;
  beforeHeight: number;
  afterHeight: number;
}

export const TIMELINE_ESTIMATED_ROW_HEIGHT = 128;
export const TIMELINE_WINDOW_THRESHOLD = 120;
export const TIMELINE_WINDOW_MIN_ROWS = 72;
export const TIMELINE_WINDOW_OVERSCAN_ROWS = 18;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const finiteNumber = (value: number, fallback: number): number =>
  Number.isFinite(value) ? value : fallback;

export const selectTimelineWindow = ({
  itemCount,
  scrollTop,
  viewportHeight,
  anchorIndex,
  stickToEnd = false,
  estimatedRowHeight = TIMELINE_ESTIMATED_ROW_HEIGHT,
  threshold = TIMELINE_WINDOW_THRESHOLD,
  minRows = TIMELINE_WINDOW_MIN_ROWS,
  overscanRows = TIMELINE_WINDOW_OVERSCAN_ROWS,
}: ISelectTimelineWindowInput): ITimelineWindow => {
  const total = Math.max(0, Math.floor(finiteNumber(itemCount, 0)));

  if (total <= threshold) {
    return {
      enabled: false,
      startIndex: 0,
      endIndex: total,
      beforeHeight: 0,
      afterHeight: 0,
    };
  }

  const rowHeight = Math.max(1, finiteNumber(estimatedRowHeight, TIMELINE_ESTIMATED_ROW_HEIGHT));
  const visibleRows = Math.ceil(Math.max(0, finiteNumber(viewportHeight, 0)) / rowHeight);
  const renderCount = Math.min(total, Math.max(minRows, visibleRows + overscanRows * 2));
  const maxStart = Math.max(0, total - renderCount);
  const normalizedAnchor = typeof anchorIndex === 'number' && Number.isFinite(anchorIndex)
    ? clamp(Math.floor(anchorIndex), 0, total - 1)
    : null;

  let startIndex: number;

  if (normalizedAnchor !== null) {
    startIndex = normalizedAnchor - Math.floor(renderCount / 2);
  } else if (stickToEnd) {
    startIndex = maxStart;
  } else {
    startIndex = Math.floor(Math.max(0, finiteNumber(scrollTop, 0)) / rowHeight) - overscanRows;
  }

  startIndex = clamp(startIndex, 0, maxStart);
  const endIndex = Math.min(total, startIndex + renderCount);

  return {
    enabled: true,
    startIndex,
    endIndex,
    beforeHeight: startIndex * rowHeight,
    afterHeight: Math.max(0, total - endIndex) * rowHeight,
  };
};
