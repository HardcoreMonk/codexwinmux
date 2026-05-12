const IPAD_SPLASH_SIZES = [
  '2048x2732',
  '1668x2388',
  '1640x2360',
  '1620x2160',
  '1488x2266',
];

export const normalizePwaSmokeUrl = (raw) => {
  const value = String(raw || '').trim();
  if (!value) throw new Error('PWA smoke URL is required');
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `http://${value}`;
  const url = new URL(withScheme);
  url.hash = '';
  return url.toString().replace(/\/$/, '');
};

const makeResult = () => ({ checks: [], errors: [] });

const addCheck = (result, ok, check, error) => {
  if (ok) result.checks.push(check);
  else result.errors.push(error);
};

const hasPngIcon = (manifest, size) =>
  Array.isArray(manifest?.icons)
  && manifest.icons.some((icon) =>
    String(icon?.sizes || '').split(/\s+/).includes(size)
    && String(icon?.type || '').toLowerCase() === 'image/png'
    && String(icon?.src || '').length > 0);

export const validatePwaManifest = (manifest, targetUrl) => {
  const result = makeResult();
  const targetOrigin = new URL(normalizePwaSmokeUrl(targetUrl)).origin;
  let startUrlOrigin = '';
  try {
    startUrlOrigin = new URL(manifest?.start_url || '', targetOrigin).origin;
  } catch {
    startUrlOrigin = '';
  }

  addCheck(result, manifest?.name === 'codexwinmux', 'manifest-name', 'manifest.name must be codexwinmux');
  addCheck(result, manifest?.short_name === 'codexwinmux', 'manifest-short-name', 'manifest.short_name must be codexwinmux');
  addCheck(result, manifest?.display === 'standalone', 'manifest-display-standalone', 'manifest.display must be standalone');
  addCheck(result, !!manifest?.start_url && startUrlOrigin === targetOrigin, 'manifest-start-url-origin', 'manifest.start_url must match target origin');
  addCheck(result, !!manifest?.theme_color, 'manifest-theme-color', 'manifest.theme_color is required');
  addCheck(result, !!manifest?.background_color, 'manifest-background-color', 'manifest.background_color is required');
  addCheck(result, hasPngIcon(manifest, '192x192'), 'manifest-icon-192', 'manifest must include a 192x192 PNG icon');
  addCheck(result, hasPngIcon(manifest, '512x512'), 'manifest-icon-512', 'manifest must include a 512x512 PNG icon');
  return result;
};

const hasPattern = (html, pattern) => pattern.test(String(html || ''));

export const validatePwaHead = (html) => {
  const result = makeResult();

  addCheck(result, hasPattern(html, /<link\b[^>]*rel=["']manifest["'][^>]*href=["']\/api\/manifest["']/i), 'head-manifest-link', 'head must link /api/manifest');
  addCheck(result, hasPattern(html, /<link\b[^>]*rel=["']apple-touch-icon["'][^>]*href=["']\/apple-touch-icon\.png["']/i), 'head-apple-touch-icon', 'head must link apple touch icon');
  addCheck(result, hasPattern(html, /<meta\b[^>]*name=["']apple-mobile-web-app-capable["'][^>]*content=["']yes["']/i), 'head-apple-mobile-web-app-capable', 'head must enable apple mobile web app capable');
  addCheck(result, hasPattern(html, /<meta\b[^>]*name=["']theme-color["'][^>]*content=["']#[0-9a-f]{6}["']/i), 'head-theme-color', 'head must include theme-color');
  addCheck(result, hasPattern(html, /<meta\b[^>]*name=["']viewport["'][^>]*content=["'][^"']*viewport-fit=cover/i), 'head-viewport-fit-cover', 'viewport must include viewport-fit=cover');

  for (const size of IPAD_SPLASH_SIZES) {
    addCheck(
      result,
      hasPattern(html, new RegExp(`<link\\b[^>]*rel=["']apple-touch-startup-image["'][^>]*href=["']/splash/splash-${size}\\.png["']`, 'i')),
      `head-ipad-splash-${size}`,
      `head must include iPad startup image ${size}`,
    );
  }

  return result;
};

export const readPngDimensions = (bytes) => {
  const view = bytes instanceof DataView
    ? bytes
    : new DataView(bytes.buffer, bytes.byteOffset ?? 0, bytes.byteLength);
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < signature.length; i += 1) {
    if (view.getUint8(i) !== signature[i]) throw new Error('not a PNG file');
  }
  const chunkType = String.fromCharCode(
    view.getUint8(12),
    view.getUint8(13),
    view.getUint8(14),
    view.getUint8(15),
  );
  if (chunkType !== 'IHDR') throw new Error('PNG IHDR chunk missing');
  return {
    width: view.getUint32(16),
    height: view.getUint32(20),
  };
};

export const validateServiceWorkerScript = (script) => {
  const result = makeResult();
  addCheck(result, /addEventListener\(["']install["']/.test(script), 'sw-install', 'service worker must handle install');
  addCheck(result, /addEventListener\(["']activate["']/.test(script), 'sw-activate', 'service worker must handle activate');
  addCheck(result, /addEventListener\(["']push["']/.test(script), 'sw-push', 'service worker must handle push');
  addCheck(result, /addEventListener\(["']notificationclick["']/.test(script), 'sw-notification-click', 'service worker must handle notificationclick');
  addCheck(
    result,
    /openWindow\(["']\/["']\)/.test(script) || /openWindow\(buildPushDeepLinkPath\(/.test(script),
    'sw-open-window',
    'service worker must open app window from notification',
  );
  return result;
};

export const mergeValidation = (...results) => ({
  checks: results.flatMap((result) => result.checks),
  errors: results.flatMap((result) => result.errors),
});

export const ipadSplashSizes = IPAD_SPLASH_SIZES;
