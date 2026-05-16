import { describe, expect, it } from 'vitest';
import {
  resolveCoreEngineBackendTransportConfig,
  resolveCoreEngineHostTransportConfig,
} from '@/lib/core-engine/transport-config';

describe('core engine transport config', () => {
  it('keeps backend in-process by default', () => {
    expect(resolveCoreEngineBackendTransportConfig({ env: {} })).toMatchObject({
      mode: 'in-process',
      host: '127.0.0.1',
      port: 8122,
      requestTimeoutMs: 10_000,
    });
  });

  it('enables backend TCP transport only when explicitly requested', () => {
    expect(resolveCoreEngineBackendTransportConfig({
      env: {
        CODEXWINMUX_CORE_ENGINE_TRANSPORT: 'tcp',
        CODEXWINMUX_CORE_ENGINE_HOST: '127.0.0.2',
        CODEXWINMUX_CORE_ENGINE_PORT: '9191',
        CODEXWINMUX_CORE_ENGINE_REQUEST_TIMEOUT_MS: '1500',
      },
    })).toEqual({
      mode: 'tcp',
      host: '127.0.0.2',
      port: 9191,
      requestTimeoutMs: 1500,
    });
  });

  it('uses process IPC for hosted core when parent IPC exists', () => {
    expect(resolveCoreEngineHostTransportConfig({
      env: {},
      hasProcessSend: true,
    })).toMatchObject({
      mode: 'process-ipc',
    });
  });

  it('uses TCP for standalone core when parent IPC is unavailable', () => {
    expect(resolveCoreEngineHostTransportConfig({
      env: {},
      hasProcessSend: false,
    })).toMatchObject({
      mode: 'tcp',
      host: '127.0.0.1',
      port: 8122,
    });
  });
});
