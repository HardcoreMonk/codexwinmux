#!/usr/bin/env node
import { chromium } from '@playwright/test';
import {
  ipadSplashSizes,
  mergeValidation,
  normalizePwaSmokeUrl,
  readPngDimensions,
  validatePwaHead,
  validatePwaManifest,
  validateServiceWorkerScript,
} from './pwa-readiness-smoke-lib.mjs';
import {
  collectBlockingConsoleEvents,
} from './android-webview-smoke-lib.mjs';

const DEFAULT_TIMEOUT_MS = 20_000;
const IPAD_PRO = {
  width: 1024,
  height: 1366,
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
};

const fail = (code, message, details = {}) => {
  console.error(JSON.stringify({ ok: false, code, message, ...details }, null, 2));
  process.exit(1);
};

const fetchText = async (url, timeoutMs) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    const text = await res.text();
    if (!res.ok) throw new Error(`${url} failed: ${res.status} ${text.slice(0, 200)}`);
    return { res, text };
  } finally {
    clearTimeout(timer);
  }
};

const fetchJson = async (url, timeoutMs) => {
  const { res, text } = await fetchText(url, timeoutMs);
  return { res, data: JSON.parse(text) };
};

const fetchBytes = async (url, timeoutMs) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`${url} failed: ${res.status}`);
    return { res, bytes: new Uint8Array(await res.arrayBuffer()) };
  } finally {
    clearTimeout(timer);
  }
};

const assertNoValidationErrors = (label, result) => {
  if (result.errors.length > 0) {
    throw new Error(`${label} failed: ${result.errors.join('; ')}`);
  }
  return result.checks;
};

const checkPngAsset = async ({ baseUrl, pathname, expected, timeoutMs }) => {
  const { res, bytes } = await fetchBytes(new URL(pathname, baseUrl), timeoutMs);
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('image/png')) {
    throw new Error(`${pathname} must be image/png, got ${contentType || '-'}`);
  }
  const size = readPngDimensions(bytes);
  if (expected && (size.width !== expected.width || size.height !== expected.height)) {
    throw new Error(`${pathname} expected ${expected.width}x${expected.height}, got ${size.width}x${size.height}`);
  }
  return { pathname, ...size, bytes: bytes.byteLength };
};

const runBrowserProbe = async ({ baseUrl, timeoutMs }) => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: IPAD_PRO.width, height: IPAD_PRO.height },
    deviceScaleFactor: IPAD_PRO.deviceScaleFactor,
    isMobile: IPAD_PRO.isMobile,
    hasTouch: IPAD_PRO.hasTouch,
    userAgent: IPAD_PRO.userAgent,
  });
  const consoleEvents = [];
  page.on('console', (msg) => {
    consoleEvents.push({ type: msg.type(), text: msg.text(), url: page.url() });
  });
  page.on('pageerror', (err) => {
    consoleEvents.push({ type: 'error', text: err.message, url: page.url() });
  });

  try {
    await page.goto(new URL('/login', baseUrl).toString(), {
      waitUntil: 'networkidle',
      timeout: timeoutMs,
    });
    const state = await page.evaluate(() => ({
      href: location.href,
      readyState: document.readyState,
      viewport: document.querySelector('meta[name="viewport"]')?.getAttribute('content') || '',
      manifestHref: document.querySelector('link[rel="manifest"]')?.getAttribute('href') || '',
      appleCapable: document.querySelector('meta[name="apple-mobile-web-app-capable"]')?.getAttribute('content') || '',
      appleTouchIcon: document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href') || '',
      hasTouch: navigator.maxTouchPoints > 0,
      serviceWorkerSupported: 'serviceWorker' in navigator,
    }));
    const blockingConsole = collectBlockingConsoleEvents(consoleEvents);
    if (blockingConsole.length > 0) {
      throw new Error(`iPad viewport saw blocking console events: ${JSON.stringify(blockingConsole.slice(0, 20))}`);
    }
    return {
      state,
      consoleEventCount: consoleEvents.length,
      blockingConsoleCount: blockingConsole.length,
    };
  } finally {
    await browser.close();
  }
};

const main = async () => {
  const baseUrl = normalizePwaSmokeUrl(process.env.CODEXMUX_PWA_SMOKE_URL || 'http://127.0.0.1:8121');
  const timeoutMs = Number(process.env.CODEXMUX_PWA_SMOKE_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  const checks = [];
  const assets = [];

  try {
    const health = await fetchJson(new URL('/api/health', baseUrl), timeoutMs).catch(() => null);
    if (health?.data?.app === 'codexmux') checks.push('health');

    const { data: manifest } = await fetchJson(new URL('/api/manifest', baseUrl), timeoutMs);
    checks.push(...assertNoValidationErrors('manifest', validatePwaManifest(manifest, baseUrl)));

    const { text: loginHtml } = await fetchText(new URL('/login', baseUrl), timeoutMs);
    checks.push(...assertNoValidationErrors('head', validatePwaHead(loginHtml)));

    const { text: serviceWorkerScript } = await fetchText(new URL('/sw.js', baseUrl), timeoutMs);
    checks.push(...assertNoValidationErrors('service worker', validateServiceWorkerScript(serviceWorkerScript)));

    assets.push(await checkPngAsset({
      baseUrl,
      pathname: '/apple-touch-icon.png',
      expected: { width: 180, height: 180 },
      timeoutMs,
    }));
    assets.push(await checkPngAsset({
      baseUrl,
      pathname: '/android-chrome-192x192.png',
      expected: { width: 192, height: 192 },
      timeoutMs,
    }));
    assets.push(await checkPngAsset({
      baseUrl,
      pathname: '/android-chrome-512x512.png',
      expected: { width: 512, height: 512 },
      timeoutMs,
    }));
    checks.push('pwa-icons');

    for (const size of ipadSplashSizes) {
      const [width, height] = size.split('x').map(Number);
      assets.push(await checkPngAsset({
        baseUrl,
        pathname: `/splash/splash-${size}.png`,
        expected: { width, height },
        timeoutMs,
      }));
      checks.push(`ipad-splash-${size}`);
    }

    const browserProbe = await runBrowserProbe({ baseUrl, timeoutMs });
    checks.push('ipad-viewport-browser');

    const browserHead = validatePwaHead(loginHtml);
    const allValidation = mergeValidation(
      validatePwaManifest(manifest, baseUrl),
      browserHead,
      validateServiceWorkerScript(serviceWorkerScript),
    );

    console.log(JSON.stringify({
      ok: true,
      baseUrl,
      health: health?.data ?? null,
      checks,
      validationCheckCount: allValidation.checks.length,
      assetCount: assets.length,
      assets,
      browserProbe,
    }, null, 2));
  } catch (err) {
    fail('pwa-readiness-smoke-failed', err instanceof Error ? err.message : String(err), {
      baseUrl,
      checks,
      assets,
    });
  }
};

main();
