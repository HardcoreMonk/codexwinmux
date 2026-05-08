import { describe, expect, it } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { pathToFileURL } from 'url';

const loadLib = async () =>
  import(pathToFileURL(path.join(process.cwd(), 'scripts/pwa-readiness-smoke-lib.mjs')).href);

describe('PWA readiness smoke helpers', () => {
  it('normalizes PWA smoke URLs', async () => {
    const { normalizePwaSmokeUrl } = await loadLib();

    expect(normalizePwaSmokeUrl('127.0.0.1:8121/')).toBe('http://127.0.0.1:8121');
    expect(normalizePwaSmokeUrl('https://gti12.tail73c4be.ts.net/login')).toBe('https://gti12.tail73c4be.ts.net/login');
  });

  it('validates codexmux manifest fields for standalone install', async () => {
    const { validatePwaManifest } = await loadLib();
    const manifest = {
      name: 'codexmux',
      short_name: 'codexmux',
      start_url: 'https://gti12.tail73c4be.ts.net/',
      display: 'standalone',
      theme_color: '#131313',
      background_color: '#131313',
      icons: [
        { src: '/android-chrome-192x192.png', sizes: '192x192', type: 'image/png' },
        { src: '/android-chrome-512x512.png', sizes: '512x512', type: 'image/png' },
      ],
    };

    expect(validatePwaManifest(manifest, 'https://gti12.tail73c4be.ts.net').checks).toEqual([
      'manifest-name',
      'manifest-short-name',
      'manifest-display-standalone',
      'manifest-start-url-origin',
      'manifest-theme-color',
      'manifest-background-color',
      'manifest-icon-192',
      'manifest-icon-512',
    ]);
  });

  it('reports missing manifest requirements', async () => {
    const { validatePwaManifest } = await loadLib();

    expect(validatePwaManifest({ name: 'codexmux', icons: [] }, 'https://example.test').errors).toEqual([
      'manifest.short_name must be codexmux',
      'manifest.display must be standalone',
      'manifest.start_url must match target origin',
      'manifest.theme_color is required',
      'manifest.background_color is required',
      'manifest must include a 192x192 PNG icon',
      'manifest must include a 512x512 PNG icon',
    ]);
  });

  it('validates iPad PWA head metadata', async () => {
    const { validatePwaHead } = await loadLib();
    const html = `
      <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover" />
      <link rel="manifest" href="/api/manifest" />
      <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
      <meta name="apple-mobile-web-app-capable" content="yes" />
      <meta name="theme-color" content="#131313" />
      <link rel="apple-touch-startup-image" href="/splash/splash-2048x2732.png" />
      <link rel="apple-touch-startup-image" href="/splash/splash-1668x2388.png" />
      <link rel="apple-touch-startup-image" href="/splash/splash-1640x2360.png" />
      <link rel="apple-touch-startup-image" href="/splash/splash-1620x2160.png" />
      <link rel="apple-touch-startup-image" href="/splash/splash-1488x2266.png" />
    `;

    expect(validatePwaHead(html).checks).toEqual([
      'head-manifest-link',
      'head-apple-touch-icon',
      'head-apple-mobile-web-app-capable',
      'head-theme-color',
      'head-viewport-fit-cover',
      'head-ipad-splash-2048x2732',
      'head-ipad-splash-1668x2388',
      'head-ipad-splash-1640x2360',
      'head-ipad-splash-1620x2160',
      'head-ipad-splash-1488x2266',
    ]);
  });

  it('keeps generated startup images branded as codexmux', async () => {
    const script = await fs.readFile(path.join(process.cwd(), 'scripts/generate-splash.js'), 'utf-8');

    expect(script).toContain('<tspan font-weight="700">codex</tspan><tspan font-weight="400">mux</tspan>');
    expect(script.toLowerCase()).not.toContain('purplemux');
    expect(script).not.toContain('>purple</tspan>');
  });

  it('reads PNG dimensions from IHDR bytes', async () => {
    const { readPngDimensions } = await loadLib();
    const bytes = new Uint8Array(24);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    bytes.set([0x49, 0x48, 0x44, 0x52], 12);
    const view = new DataView(bytes.buffer);
    view.setUint32(16, 2048);
    view.setUint32(20, 2732);

    expect(readPngDimensions(bytes)).toEqual({ width: 2048, height: 2732 });
  });

  it('validates service worker push and notification click support', async () => {
    const { validateServiceWorkerScript } = await loadLib();
    const script = `
      self.addEventListener('install', () => self.skipWaiting());
      self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
      self.addEventListener('push', () => {});
      self.addEventListener('notificationclick', () => self.clients.openWindow('/'));
    `;

    expect(validateServiceWorkerScript(script).checks).toEqual([
      'sw-install',
      'sw-activate',
      'sw-push',
      'sw-notification-click',
      'sw-open-window',
    ]);
  });

  it('accepts service worker notification deep link windows', async () => {
    const { validateServiceWorkerScript } = await loadLib();
    const script = await fs.readFile(path.join(process.cwd(), 'public/sw.js'), 'utf-8');

    expect(validateServiceWorkerScript(script).errors).toEqual([]);
    expect(validateServiceWorkerScript(script).checks).toContain('sw-open-window');
  });
});
