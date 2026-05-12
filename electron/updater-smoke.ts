import * as fs from 'fs';
import * as path from 'path';

export interface IUpdaterSmokeConfig {
  enabled: boolean;
  feedUrl: string | null;
  statusPath: string | null;
  autoDownload: boolean;
  autoInstall: boolean;
  installDir: string | null;
  disableDifferentialDownload: boolean;
}

type TUpdaterSmokeEventPayload = {
  version?: string;
  feedUrl?: string;
  feedProvider?: string;
  percent?: number;
  downloadedFile?: string;
  error?: unknown;
};

type TUpdaterSmokeEnv = Record<string, string | undefined>;

export const readUpdaterSmokeConfig = (env: TUpdaterSmokeEnv = process.env): IUpdaterSmokeConfig => {
  const enabled = env.CODEXMUX_ELECTRON_UPDATER_SMOKE === '1';
  return {
    enabled,
    feedUrl: enabled ? env.CODEXMUX_ELECTRON_UPDATER_FEED_URL || null : null,
    statusPath: enabled ? env.CODEXMUX_ELECTRON_UPDATER_SMOKE_STATUS_PATH || null : null,
    autoDownload: enabled && env.CODEXMUX_ELECTRON_UPDATER_SMOKE_AUTO_DOWNLOAD === '1',
    autoInstall: enabled && env.CODEXMUX_ELECTRON_UPDATER_SMOKE_AUTO_INSTALL === '1',
    installDir: enabled ? env.CODEXMUX_ELECTRON_UPDATER_SMOKE_INSTALL_DIR || null : null,
    disableDifferentialDownload: enabled && env.CODEXMUX_ELECTRON_UPDATER_DISABLE_DIFFERENTIAL === '1',
  };
};

export const sanitizeUpdaterDownloadedFileName = (downloadedFile?: string): string | null => {
  if (!downloadedFile) return null;
  return path.win32.basename(downloadedFile);
};

export const buildUpdaterSmokeStatusEvent = (
  event: string,
  payload: TUpdaterSmokeEventPayload = {},
) => ({
  event,
  at: new Date().toISOString(),
  ...(payload.version ? { version: payload.version } : {}),
  ...(payload.feedProvider ? { feedProvider: payload.feedProvider } : {}),
  ...(payload.feedUrl ? { feedHost: (() => {
    try {
      return new URL(payload.feedUrl).host;
    } catch {
      return null;
    }
  })() } : {}),
  ...(Number.isFinite(payload.percent) ? { percent: Math.max(0, Math.min(100, Number(payload.percent))) } : {}),
  ...(payload.downloadedFile ? { downloadedFileName: sanitizeUpdaterDownloadedFileName(payload.downloadedFile) } : {}),
  ...(payload.error ? { error: payload.error instanceof Error ? payload.error.message : String(payload.error) } : {}),
});

export const appendUpdaterSmokeStatus = (
  config: IUpdaterSmokeConfig,
  event: string,
  payload: TUpdaterSmokeEventPayload = {},
) => {
  if (!config.enabled || !config.statusPath) return;
  try {
    fs.mkdirSync(path.dirname(config.statusPath), { recursive: true });
    fs.appendFileSync(
      config.statusPath,
      `${JSON.stringify(buildUpdaterSmokeStatusEvent(event, payload))}\n`,
      'utf8',
    );
  } catch (err) {
    console.error('[updater-smoke] failed to write status:', err);
  }
};
