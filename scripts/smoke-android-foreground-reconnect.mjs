#!/usr/bin/env node
import {
  DEFAULT_ANDROID_ACTIVITY,
  DEFAULT_ANDROID_APP_ID,
  adbArgsFor,
  attachConsoleCollectors,
  backgroundAndroidApp,
  clearAndroidAppData,
  clearLogcat,
  collectBlockingConsoleEvents,
  collectBlockingLogcatLines,
  connectCdp,
  discoverDevtoolsTarget,
  dumpLogcat,
  enableCdpDomains,
  evaluate,
  findAdb,
  forceStopAndroidApp,
  isExpectedRemoteState,
  isSmokeFlagEnabled,
  navigateCdp,
  readWebViewState,
  removeForward,
  resolveAndroidSmokeUrl,
  selectAndroidSerial,
  sleep,
  startAndroidApp,
  waitForExpectedRemoteState,
} from './android-webview-smoke-lib.mjs';
import { writeSmokeArtifact } from './smoke-artifact-lib.mjs';

const SMOKE_NAME = 'android-foreground';
const startedAt = new Date().toISOString();

const writeArtifact = async (status, payload) =>
  writeSmokeArtifact({
    smokeName: SMOKE_NAME,
    status,
    startedAt,
    payload,
  }).catch((err) => {
    console.error(JSON.stringify({
      ok: false,
      code: 'smoke-artifact-write-failed',
      message: err instanceof Error ? err.message : String(err),
    }, null, 2));
  });

const envNumber = (name, fallback) => {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative number`);
  return parsed;
};

const fail = async (code, message, details = {}) => {
  const payload = { ok: false, code, message, ...details };
  await writeArtifact('failed', payload);
  console.error(JSON.stringify(payload, null, 2));
  process.exit(1);
};

const getAndroidAppInfo = (cdp) =>
  evaluate(cdp, `(() => {
    const api = window.CodexmuxAndroid;
    if (!api) return null;
    return {
      versionName: api.getVersionName?.() || '-',
      versionCode: api.getVersionCode?.() || '-',
      packageName: api.getPackageName?.() || '-',
      deviceModel: api.getDeviceModel?.() || '-',
      androidVersion: api.getAndroidVersion?.() || '-',
      canRestart: typeof api.restartApp === 'function'
    };
  })()`);

const triggerAndroidRestart = (cdp) =>
  evaluate(cdp, `(() => {
    const api = window.CodexmuxAndroid;
    if (!api || typeof api.restartApp !== 'function') return false;
    api.restartApp();
    return true;
  })()`);

const main = async () => {
  const targetUrl = resolveAndroidSmokeUrl(process.env.CODEXMUX_ANDROID_SMOKE_URL);
  const backgroundMs = envNumber('CODEXMUX_ANDROID_BACKGROUND_MS', 12_000);
  const rounds = envNumber('CODEXMUX_ANDROID_FOREGROUND_ROUNDS', 2);
  const settleMs = envNumber('CODEXMUX_ANDROID_RECONNECT_SETTLE_MS', 3_000);
  const restartApp = isSmokeFlagEnabled(process.env.CODEXMUX_ANDROID_RESTART_APP);
  const requestedPort = process.env.CODEXMUX_ANDROID_DEVTOOLS_PORT
    ? Number(process.env.CODEXMUX_ANDROID_DEVTOOLS_PORT)
    : undefined;
  const appId = process.env.CODEXMUX_ANDROID_APP_ID || DEFAULT_ANDROID_APP_ID;
  const activity = process.env.CODEXMUX_ANDROID_ACTIVITY || DEFAULT_ANDROID_ACTIVITY;

  const adb = findAdb();
  const serial = selectAndroidSerial(adb);
  const adbArgs = adbArgsFor(serial);
  const consoleEvents = [];
  const checks = [];
  let cdp = null;
  let forward = null;

  const connectWebView = async () => {
    if (cdp) cdp.close();
    if (forward) removeForward({ adb, adbArgs, port: forward.port });
    forward = await discoverDevtoolsTarget({ adb, adbArgs, expectedUrl: targetUrl, requestedPort });
    cdp = await connectCdp(forward.target.webSocketDebuggerUrl);
    attachConsoleCollectors(cdp, consoleEvents);
    await enableCdpDomains(cdp);
    return cdp;
  };

  const ensureRemote = async (label) => {
    try {
      const state = await readWebViewState(cdp);
      if (!isExpectedRemoteState(state, targetUrl)) {
        await navigateCdp(cdp, targetUrl);
      }
      return await waitForExpectedRemoteState(cdp, targetUrl);
    } catch {
      await connectWebView();
      const state = await readWebViewState(cdp);
      if (!isExpectedRemoteState(state, targetUrl)) {
        await navigateCdp(cdp, targetUrl);
      }
      return await waitForExpectedRemoteState(cdp, targetUrl);
    } finally {
      checks.push(label);
    }
  };

  try {
    clearLogcat({ adb, adbArgs });
    if (process.env.CODEXMUX_ANDROID_CLEAR_APP_DATA === '1') {
      forceStopAndroidApp({ adb, adbArgs, appId });
      clearAndroidAppData({ adb, adbArgs, appId });
      checks.push('app-data-clear');
    }

    startAndroidApp({ adb, adbArgs, activity });
    await sleep(1_000);
    await connectWebView();
    const initialState = await ensureRemote('initial-remote-state');
    const appInfo = await getAndroidAppInfo(cdp);

    if (initialState.bridgeTriggerEventType !== 'function') {
      await fail('android-trigger-event-fallback-missing', 'Capacitor triggerEvent fallback was not installed', { initialState });
    }
    if (!appInfo) {
      await fail('android-app-info-bridge-missing', 'CodexmuxAndroid app info bridge is not available', { initialState });
    }

    for (let i = 0; i < rounds; i += 1) {
      backgroundAndroidApp({ adb, adbArgs });
      await sleep(backgroundMs);
      startAndroidApp({ adb, adbArgs, activity });
      const state = await ensureRemote(`foreground-round-${i + 1}`);
      await sleep(settleMs);
      const settledState = await waitForExpectedRemoteState(cdp, targetUrl);
      if (settledState.bridgeTriggerEventType !== 'function') {
        await fail('android-trigger-event-fallback-missing-after-foreground', 'triggerEvent fallback disappeared after foreground reconnect', {
          round: i + 1,
          state,
          settledState,
        });
      }
    }

    if (restartApp) {
      const restarted = await triggerAndroidRestart(cdp);
      if (!restarted) {
        await fail('android-app-restart-bridge-missing', 'CodexmuxAndroid.restartApp is not available', { appInfo });
      }
      checks.push('app-restart-triggered');
      await sleep(2_000);
      await connectWebView();
      const restartState = await ensureRemote('app-restart-remote-state');
      if (restartState.bridgeTriggerEventType !== 'function') {
        await fail('android-trigger-event-fallback-missing-after-restart', 'triggerEvent fallback disappeared after native app restart', {
          restartState,
        });
      }
    }

    const finalState = await waitForExpectedRemoteState(cdp, targetUrl);
    const blockingConsole = collectBlockingConsoleEvents(consoleEvents);
    const logcat = dumpLogcat({ adb, adbArgs });
    const blockingLogcat = collectBlockingLogcatLines(logcat);

    if (blockingConsole.length > 0 || blockingLogcat.length > 0) {
      await fail('android-foreground-reconnect-failed', 'Android foreground reconnect produced blocking console or logcat errors', {
        targetUrl,
        serial,
        rounds,
        backgroundMs,
        blockingConsole,
        blockingLogcat: blockingLogcat.slice(0, 40),
        finalState,
      });
    }

    const payload = {
      ok: true,
      adb,
      serial,
      appId,
      activity,
      targetUrl,
      rounds,
      backgroundMs,
      restartApp,
      checks,
      appInfo,
      initialHref: initialState.href,
      finalHref: finalState.href,
      consoleEventCount: consoleEvents.length,
      blockingConsoleCount: blockingConsole.length,
      blockingLogcatCount: blockingLogcat.length,
      devtools: forward,
    };
    await writeArtifact('passed', payload);
    console.log(JSON.stringify(payload, null, 2));
  } catch (err) {
    await fail('android-foreground-smoke-error', err instanceof Error ? err.message : String(err), {
      targetUrl,
      serial,
      checks,
      consoleEvents: consoleEvents.slice(-20),
    });
  } finally {
    if (cdp) cdp.close();
    if (forward) removeForward({ adb, adbArgs, port: forward.port });
  }
};

main();
