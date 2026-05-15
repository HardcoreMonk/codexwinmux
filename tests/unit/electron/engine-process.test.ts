import { describe, expect, it } from 'vitest';
import {
  buildCoreProcessArgs,
  buildEngineProcessArgs,
  coreProcessFlag,
  engineProcessFlag,
  isCoreProcessLaunch,
  isEngineProcessLaunch,
  resolveElectronProcessRole,
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

  it('recognizes the canonical core-only CLI flag', () => {
    expect(isCoreProcessLaunch(['codexwinmux.exe', coreProcessFlag], {})).toBe(true);
  });

  it('recognizes the canonical core-only environment marker', () => {
    expect(isCoreProcessLaunch(['codexwinmux.exe'], {
      CODEXWINMUX_ELECTRON_CORE_PROCESS: '1',
    })).toBe(true);
  });

  it('keeps engine and core launch roles mutually exclusive', () => {
    expect(resolveElectronProcessRole(['codexwinmux.exe', coreProcessFlag], {})).toBe('core');
    expect(resolveElectronProcessRole(['codexwinmux.exe', engineProcessFlag], {})).toBe('engine');
    expect(resolveElectronProcessRole(['codexwinmux.exe'], {})).toBe('ui');
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

  it('passes the core-only flag to packaged and development launches', () => {
    expect(buildCoreProcessArgs({
      isPackaged: true,
      appPath: 'D:\\apps\\codexwinmux\\resources\\app.asar',
    })).toEqual([coreProcessFlag]);
    expect(buildCoreProcessArgs({
      isPackaged: false,
      appPath: 'D:\\projects\\codexwinmux',
    })).toEqual(['D:\\projects\\codexwinmux', coreProcessFlag]);
  });
});
