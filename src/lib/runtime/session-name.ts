import { customAlphabet } from 'nanoid';
import { z } from 'zod';

export const RUNTIME_SESSION_PREFIX = 'rtv2-';
export const RUNTIME_SESSION_NAME_MAX_LENGTH = 120;

const runtimeSafeId = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 10);
const WORKSPACE_SESSION_COMPONENT_MAX_LENGTH = 32;
const PANE_SESSION_COMPONENT_MAX_LENGTH = 32;
const TAB_SESSION_COMPONENT_MAX_LENGTH = 49;

const toRuntimeSessionComponent = (value: string, maxLength: number): string => {
  const safe = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
  const component = safe || 'x';
  return component.length > maxLength
    ? component.slice(0, maxLength).replace(/-+$/g, '') || 'x'
    : component;
};

export const runtimeSessionNameSchema = z.string()
  .min(RUNTIME_SESSION_PREFIX.length + 1)
  .max(RUNTIME_SESSION_NAME_MAX_LENGTH)
  .regex(
    /^rtv2-[a-z0-9][a-z0-9-]*$/,
    'runtime v2 terminal session names must be tmux-safe and start with rtv2-',
  );

export const createRuntimeId = (prefix: 'ws' | 'pane' | 'tab' | 'evt' | 'sub' | 'msg' | 'grp'): string =>
  `${prefix}-${runtimeSafeId()}`;

export const parseRuntimeSessionName = (sessionName: string): string =>
  runtimeSessionNameSchema.parse(sessionName);

export const createRuntimeSessionName = (input: {
  workspaceId: string;
  paneId: string;
  tabId: string;
}): string => {
  const workspaceId = toRuntimeSessionComponent(input.workspaceId, WORKSPACE_SESSION_COMPONENT_MAX_LENGTH);
  const paneId = toRuntimeSessionComponent(input.paneId, PANE_SESSION_COMPONENT_MAX_LENGTH);
  const tabId = toRuntimeSessionComponent(input.tabId, TAB_SESSION_COMPONENT_MAX_LENGTH);
  return parseRuntimeSessionName(`${RUNTIME_SESSION_PREFIX}${workspaceId}-${paneId}-${tabId}`);
};
