import { describe, expect, it } from 'vitest';
import {
  getRuntimeTimelineV2Mode,
  parseRuntimeTimelineV2Mode,
  shouldRunRuntimeTimelineV2Shadow,
  shouldUseRuntimeTimelineV2Live,
  shouldUseRuntimeTimelineV2Reads,
} from '@/lib/runtime/timeline-mode';

describe('runtime timeline v2 mode', () => {
  it('parses timeline mode fail-closed', () => {
    expect(parseRuntimeTimelineV2Mode('shadow')).toBe('shadow');
    expect(parseRuntimeTimelineV2Mode('default')).toBe('default');
    expect(parseRuntimeTimelineV2Mode('write')).toBe('off');
    expect(parseRuntimeTimelineV2Mode(undefined)).toBe('off');
  });

  it('defaults to timeline default when runtime v2 is enabled and timeline mode is unset', () => {
    expect(getRuntimeTimelineV2Mode({
      CODEXWINMUX_RUNTIME_V2: '1',
    } as unknown as NodeJS.ProcessEnv)).toBe('default');
    expect(getRuntimeTimelineV2Mode({
      CODEXWINMUX_RUNTIME_V2: '1',
      CODEXWINMUX_RUNTIME_TIMELINE_V2_MODE: 'off',
    } as unknown as NodeJS.ProcessEnv)).toBe('off');
    expect(getRuntimeTimelineV2Mode({
      CODEXWINMUX_RUNTIME_V2: '1',
      CODEXWINMUX_RUNTIME_TIMELINE_V2_MODE: 'invalid',
    } as unknown as NodeJS.ProcessEnv)).toBe('off');
    expect(getRuntimeTimelineV2Mode({} as unknown as NodeJS.ProcessEnv)).toBe('off');
  });

  it('ignores legacy CODEXMUX timeline mode env after migration', () => {
    expect(getRuntimeTimelineV2Mode({
      CODEXWINMUX_RUNTIME_V2: '1',
      CODEXMUX_RUNTIME_V2: '0',
      CODEXWINMUX_RUNTIME_TIMELINE_V2_MODE: 'default',
      CODEXMUX_RUNTIME_TIMELINE_V2_MODE: 'off',
    } as unknown as NodeJS.ProcessEnv)).toBe('default');
  });

  it('allows live timeline ownership only for runtime default mode', () => {
    expect(shouldUseRuntimeTimelineV2Live({
      runtimeV2Enabled: true,
      timelineMode: 'default',
    })).toBe(true);
    expect(shouldUseRuntimeTimelineV2Live({
      runtimeV2Enabled: true,
      timelineMode: 'shadow',
    })).toBe(false);
    expect(shouldUseRuntimeTimelineV2Live({
      runtimeV2Enabled: false,
      timelineMode: 'default',
    })).toBe(false);
  });

  it('uses the process env phase 6 fallback for live timeline ownership', () => {
    const originalRuntime = process.env.CODEXWINMUX_RUNTIME_V2;
    const originalMode = process.env.CODEXWINMUX_RUNTIME_TIMELINE_V2_MODE;
    try {
      process.env.CODEXWINMUX_RUNTIME_V2 = '1';
      delete process.env.CODEXWINMUX_RUNTIME_TIMELINE_V2_MODE;
      expect(shouldUseRuntimeTimelineV2Live()).toBe(true);

      process.env.CODEXWINMUX_RUNTIME_TIMELINE_V2_MODE = 'off';
      expect(shouldUseRuntimeTimelineV2Live()).toBe(false);
    } finally {
      if (originalRuntime === undefined) delete process.env.CODEXWINMUX_RUNTIME_V2;
      else process.env.CODEXWINMUX_RUNTIME_V2 = originalRuntime;
      if (originalMode === undefined) delete process.env.CODEXWINMUX_RUNTIME_TIMELINE_V2_MODE;
      else process.env.CODEXWINMUX_RUNTIME_TIMELINE_V2_MODE = originalMode;
    }
  });

  it('allows timeline read ownership only for runtime default mode', () => {
    expect(shouldUseRuntimeTimelineV2Reads({
      runtimeV2Enabled: true,
      timelineMode: 'default',
    })).toBe(true);
    expect(shouldUseRuntimeTimelineV2Reads({
      runtimeV2Enabled: true,
      timelineMode: 'shadow',
    })).toBe(false);
    expect(shouldUseRuntimeTimelineV2Reads({
      runtimeV2Enabled: false,
      timelineMode: 'default',
    })).toBe(false);
  });

  it('runs shadow comparison only for runtime shadow mode', () => {
    expect(shouldRunRuntimeTimelineV2Shadow({
      runtimeV2Enabled: true,
      timelineMode: 'shadow',
    })).toBe(true);
    expect(shouldRunRuntimeTimelineV2Shadow({
      runtimeV2Enabled: true,
      timelineMode: 'default',
    })).toBe(false);
    expect(shouldRunRuntimeTimelineV2Shadow({
      runtimeV2Enabled: false,
      timelineMode: 'shadow',
    })).toBe(false);
  });

  it('reads timeline mode from an explicit env object', () => {
    expect(getRuntimeTimelineV2Mode({
      CODEXWINMUX_RUNTIME_TIMELINE_V2_MODE: 'shadow',
    } as unknown as NodeJS.ProcessEnv)).toBe('shadow');
  });
});
