import { describe, expect, it } from 'vitest';
import path from 'path';
import { pathToFileURL } from 'url';

const loadLib = async () =>
  import(pathToFileURL(path.join(process.cwd(), 'scripts/runtime-v2-phase2-smoke-lib.mjs')).href);

describe('runtime v2 phase 2 smoke helpers', () => {
  it('collects pane nodes and tabs from split layouts', async () => {
    const { collectPaneNodes, collectLayoutTabs } = await loadLib();
    const layout = {
      root: {
        type: 'split',
        orientation: 'horizontal',
        ratio: 50,
        children: [
          {
            type: 'pane',
            id: 'pane-a',
            activeTabId: 'tab-a',
            tabs: [{ id: 'tab-a', sessionName: 'pt-a', runtimeVersion: 1 }],
          },
          {
            type: 'pane',
            id: 'pane-b',
            activeTabId: 'tab-b',
            tabs: [{ id: 'tab-b', sessionName: 'rtv2-b', runtimeVersion: 2 }],
          },
        ],
      },
      activePaneId: 'pane-a',
    };

    expect(collectPaneNodes(layout).map((pane: { id: string }) => pane.id)).toEqual(['pane-a', 'pane-b']);
    expect(collectLayoutTabs(layout).map((tab: { id: string }) => tab.id)).toEqual(['tab-a', 'tab-b']);
  });

  it('selects terminal websocket endpoints from runtime identity', async () => {
    const { resolveSmokeTerminalEndpoint } = await loadLib();

    expect(resolveSmokeTerminalEndpoint({ runtimeVersion: 1 })).toBe('/api/terminal');
    expect(resolveSmokeTerminalEndpoint({ runtimeVersion: 2 })).toBe('/api/v2/terminal');
    expect(resolveSmokeTerminalEndpoint({})).toBe('/api/terminal');
  });

  it('builds websocket urls for legacy and runtime v2 endpoints', async () => {
    const { buildSmokeTerminalWsUrl } = await loadLib();

    expect(buildSmokeTerminalWsUrl({
      baseUrl: 'http://127.0.0.1:8121',
      endpoint: '/api/terminal',
      sessionName: 'pt-ws-pane-tab',
      clientId: 'client-a',
      cols: 100,
      rows: 30,
    }).toString()).toBe('ws://127.0.0.1:8121/api/terminal?clientId=client-a&session=pt-ws-pane-tab&cols=100&rows=30');

    expect(buildSmokeTerminalWsUrl({
      baseUrl: 'https://codexmux.test/base',
      endpoint: '/api/v2/terminal',
      sessionName: 'rtv2-ws-pane-tab',
      clientId: 'client-b',
    }).toString()).toBe('wss://codexmux.test/api/v2/terminal?clientId=client-b&session=rtv2-ws-pane-tab');
  });

  it('extracts a cookie header from a setup or login response', async () => {
    const { extractCookieHeader } = await loadLib();

    expect(extractCookieHeader({
      headers: {
        getSetCookie: () => ['session-token=abc; Path=/; HttpOnly'],
      },
    })).toBe('session-token=abc');

    expect(extractCookieHeader({
      headers: {
        get: () => 'session-token=def; Path=/; HttpOnly',
      },
    })).toBe('session-token=def');
  });
});
