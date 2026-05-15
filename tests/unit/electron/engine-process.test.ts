import { describe, expect, it } from 'vitest';
import {
  buildEngineProcessArgs,
  engineProcessFlag,
  isEngineProcessLaunch,
} from '../../../electron/engine-process';

describe('Electron engine process launch contract', () => {
  it('recognizes the canonical engine-only CLI flag', () => {
    expect(isEngineProcessLaunch(['codexwinmux.exe', engineProcessFlag], {})).toBe(true);
  });

  it('recognizes canonical and legacy engine-only environment markers', () => {
    expect(isEngineProcessLaunch(['codexwinmux.exe'], {
      CODEXWINMUX_ELECTRON_ENGINE_PROCESS: '1',
    })).toBe(true);
    expect(isEngineProcessLaunch(['codexwinmux.exe'], {
      CODEXMUX_ELECTRON_ENGINE_PROCESS: '1',
    })).toBe(true);
  });

  it('does not treat normal UI launches as engine-only launches', () => {
    expect(isEngineProcessLaunch(['codexwinmux.exe'], {})).toBe(false);
  });

  it('passes the engine-only flag directly to packaged app launches', () => {
    expect(buildEngineProcessArgs({
      isPackaged: true,
      appPath: 'D:\\apps\\codexwinmux\\resources\\app.asar',
    })).toEqual([engineProcessFlag]);
  });

  it('passes app path before the engine-only flag in development launches', () => {
    expect(buildEngineProcessArgs({
      isPackaged: false,
      appPath: 'D:\\projects\\codexwinmux',
    })).toEqual(['D:\\projects\\codexwinmux', engineProcessFlag]);
  });
});
