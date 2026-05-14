import type { NextApiRequest, NextApiResponse } from 'next';
import { getConfig, updateConfig, hashPassword, generateSecret } from '@/lib/config-store';
import type { IConfigData } from '@/lib/config-store';
import type { TNetworkAccess } from '@/lib/network-access';
import { isBoundToLocalhostOnly, updateAccessFromConfig } from '@/lib/access-filter';
import { isValidEditorPreset } from '@/lib/editor-url';
import { isValidToastPosition } from '@/lib/toast-position';
import { CODEX_APPROVAL_POLICIES, CODEX_SANDBOX_MODES } from '@/lib/codex-command';
import { isSupportedLocale, normalizeLocale } from '@/lib/locales';
import { broadcastSync } from '@/lib/sync-server';

const ALLOWED_FIELDS: (keyof Omit<IConfigData, 'updatedAt' | 'authSecret'>)[] = [
  'appTheme', 'terminalTheme', 'customCSS', 'dangerouslySkipPermissions', 'codexModel', 'codexSandbox', 'codexApprovalPolicy', 'codexSearchEnabled', 'codexShowTerminal', 'editorUrl', 'editorPreset', 'authPassword', 'notificationsEnabled', 'soundOnCompleteEnabled', 'toastOnCompleteEnabled', 'toastDuration', 'toastPositionDesktop', 'toastPositionMobile', 'locale', 'fontSize', 'systemResourcesEnabled', 'networkAccess',
];

const NETWORK_ACCESS_VALUES = ['localhost', 'tailscale', 'all'] as const;
const isValidNetworkAccess = (value: unknown): boolean =>
  typeof value === 'string' && (NETWORK_ACCESS_VALUES as readonly string[]).includes(value);

const isValidEditorUrl = (value: unknown): value is string =>
  typeof value === 'string';

const isValidToastDuration = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 1000 && value <= 60_000;

const isValidCodexModel = (value: unknown): boolean =>
  value === null || (typeof value === 'string' && value.length <= 100);

const isValidCodexSandbox = (value: unknown): boolean =>
  value === null || (typeof value === 'string' && (CODEX_SANDBOX_MODES as readonly string[]).includes(value));

const isValidCodexApprovalPolicy = (value: unknown): boolean =>
  value === null || (typeof value === 'string' && (CODEX_APPROVAL_POLICIES as readonly string[]).includes(value));

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') {
    const { authPassword, authSecret: _, ...safe } = await getConfig();
    const hostEnvLocked = typeof process.env.HOST === 'string' && process.env.HOST.trim().length > 0;
    return res.status(200).json({
      ...safe,
      locale: normalizeLocale(safe.locale),
      hasAuthPassword: !!authPassword,
      hostEnvLocked,
      bindHostIsLocal: isBoundToLocalhostOnly(),
    });
  }

  if (req.method === 'PATCH') {
    const body = req.body ?? {};
    const updates: Record<string, unknown> = {};
    for (const key of ALLOWED_FIELDS) {
      if (key in body) updates[key] = body[key];
    }

    if ('editorUrl' in updates && !isValidEditorUrl(updates.editorUrl)) {
      return res.status(400).json({ error: 'editorUrl must be a string.' });
    }

    if ('editorPreset' in updates && !isValidEditorPreset(updates.editorPreset)) {
      return res.status(400).json({ error: 'editorPreset is invalid.' });
    }

    if ('networkAccess' in updates && !isValidNetworkAccess(updates.networkAccess)) {
      return res.status(400).json({ error: 'networkAccess must be one of: localhost, tailscale, all.' });
    }

    if ('toastPositionDesktop' in updates && !isValidToastPosition(updates.toastPositionDesktop)) {
      return res.status(400).json({ error: 'toastPositionDesktop is invalid.' });
    }

    if ('toastPositionMobile' in updates && !isValidToastPosition(updates.toastPositionMobile)) {
      return res.status(400).json({ error: 'toastPositionMobile is invalid.' });
    }

    if ('toastDuration' in updates && !isValidToastDuration(updates.toastDuration)) {
      return res.status(400).json({ error: 'toastDuration must be a number between 1000 and 60000.' });
    }

    if ('soundOnCompleteEnabled' in updates && typeof updates.soundOnCompleteEnabled !== 'boolean') {
      return res.status(400).json({ error: 'soundOnCompleteEnabled must be a boolean.' });
    }

    if ('locale' in updates && !isSupportedLocale(updates.locale)) {
      return res.status(400).json({ error: 'locale must be one of: en, ko.' });
    }

    if ('codexModel' in updates && !isValidCodexModel(updates.codexModel)) {
      return res.status(400).json({ error: 'codexModel must be a string up to 100 characters.' });
    }

    if ('codexSandbox' in updates && !isValidCodexSandbox(updates.codexSandbox)) {
      return res.status(400).json({ error: 'codexSandbox is invalid.' });
    }

    if ('codexApprovalPolicy' in updates && !isValidCodexApprovalPolicy(updates.codexApprovalPolicy)) {
      return res.status(400).json({ error: 'codexApprovalPolicy is invalid.' });
    }

    if ('codexSearchEnabled' in updates && typeof updates.codexSearchEnabled !== 'boolean') {
      return res.status(400).json({ error: 'codexSearchEnabled must be a boolean.' });
    }

    if ('codexShowTerminal' in updates && typeof updates.codexShowTerminal !== 'boolean') {
      return res.status(400).json({ error: 'codexShowTerminal must be a boolean.' });
    }

    if (typeof updates.authPassword === 'string' && updates.authPassword) {
      const hashed = await hashPassword(updates.authPassword as string);
      const secret = generateSecret();
      updates.authPassword = hashed;
      updates.authSecret = secret;

      await updateConfig(updates as Partial<Omit<IConfigData, 'updatedAt'>>);

      process.env.AUTH_PASSWORD = hashed;
      process.env.NEXTAUTH_SECRET = secret;
    } else {
      delete updates.authPassword;
      await updateConfig(updates as Partial<Omit<IConfigData, 'updatedAt'>>);
    }

    if ('networkAccess' in updates) {
      updateAccessFromConfig(updates.networkAccess as TNetworkAccess);
    }

    broadcastSync({ type: 'config' });
    return res.status(200).json({ ok: true });
  }

  res.setHeader('Allow', 'GET, PATCH');
  return res.status(405).json({ error: 'Method not allowed' });
};

export default handler;
