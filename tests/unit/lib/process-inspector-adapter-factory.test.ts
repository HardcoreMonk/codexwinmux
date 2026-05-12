import { describe, expect, it } from 'vitest';
import {
  createProcessInspectorAdapter,
  resolveProcessInspectorAdapterKind,
  type IProcessInspector,
} from '@/lib/process-inspector';

const createFakeInspector = (): IProcessInspector => ({
  isRunning: async () => true,
  getChildren: async () => [],
  getChildrenOf: async () => [],
  getDescendants: async () => [],
  getCwd: async () => null,
  getCommand: async () => null,
  getStartTime: async () => null,
  findDescendants: async () => [],
});

describe('process inspector adapter factory', () => {
  it('selects the Windows process inspector by default on win32', () => {
    expect(resolveProcessInspectorAdapterKind({
      env: {},
      platform: 'win32',
    })).toBe('windows');
  });

  it('keeps the POSIX inspector as the non-Windows default', () => {
    expect(resolveProcessInspectorAdapterKind({
      env: {},
      platform: 'linux',
    })).toBe('posix');
  });

  it('resolves the Windows process inspector kind without claiming it is implemented', () => {
    expect(resolveProcessInspectorAdapterKind({
      env: { CODEXWINMUX_PROCESS_INSPECTOR_ADAPTER: 'windows' },
      platform: 'win32',
    })).toBe('windows');
  });

  it('prefers the CODEXWINMUX process inspector alias over the legacy CODEXMUX env', () => {
    expect(resolveProcessInspectorAdapterKind({
      env: {
        CODEXWINMUX_PROCESS_INSPECTOR_ADAPTER: 'windows',
        CODEXMUX_PROCESS_INSPECTOR_ADAPTER: 'posix',
      },
      platform: 'linux',
    })).toBe('windows');
  });

  it('fails closed when an unknown process inspector adapter is requested', () => {
    expect(() => resolveProcessInspectorAdapterKind({
      env: { CODEXMUX_PROCESS_INSPECTOR_ADAPTER: 'wmic' },
      platform: 'win32',
    })).toThrow(expect.objectContaining({
      code: 'runtime-v2-process-inspector-adapter-unsupported',
      retryable: false,
    }));
  });

  it('creates the selected POSIX process inspector through an injectable factory', async () => {
    const inspector = createProcessInspectorAdapter({
      env: { CODEXMUX_PROCESS_INSPECTOR_ADAPTER: 'posix' },
      createPosixInspector: createFakeInspector,
    });

    await expect(inspector.isRunning(process.pid)).resolves.toBe(true);
  });

  it('creates the selected Windows process inspector through the factory', async () => {
    const inspector = createProcessInspectorAdapter({
      env: { CODEXMUX_PROCESS_INSPECTOR_ADAPTER: 'windows' },
      platform: 'win32',
    });

    if (process.platform !== 'win32') {
      await expect(inspector.isRunning(process.pid)).rejects.toMatchObject({
        code: 'runtime-v2-windows-process-inspector-platform-mismatch',
        retryable: false,
      });
      return;
    }

    await expect(inspector.isRunning(process.pid)).resolves.toBe(true);
  });
});
