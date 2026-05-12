import { describe, expect, it } from 'vitest';

import {
  CODEXMUX_CODEX_HOOKS_CONFIG,
  buildCodexLaunchCommand,
  buildCodexResumeCommand,
  isValidCodexThreadId,
} from '@/lib/codex-command';

describe('codex command helpers', () => {
  it('validates Codex thread ids', () => {
    expect(isValidCodexThreadId('019dcf1f-3a02-73a0-a79e-8703b99a2f30')).toBe(true);
    expect(isValidCodexThreadId('latest')).toBe(false);
    expect(isValidCodexThreadId(null)).toBe(false);
  });

  it('builds a launch command with common runtime options', () => {
    expect(buildCodexLaunchCommand({
      cwd: '/tmp/my project',
      model: 'gpt-5.5',
      sandbox: 'danger-full-access',
      approvalPolicy: 'on-request',
      search: true,
    })).toBe(
      "codex -c 'hooks={path=\"~/.codexwinmux/hooks.json\"}' --cd '/tmp/my project' --model 'gpt-5.5' --sandbox danger-full-access --ask-for-approval on-request --search",
    );
  });

  it('exposes the codexmux hook config path for command construction', () => {
    expect(CODEXMUX_CODEX_HOOKS_CONFIG).toBe('hooks={path="~/.codexwinmux/hooks.json"}');
  });

  it('builds a resume command for a valid thread id', () => {
    expect(buildCodexResumeCommand('019dcf1f-3a02-73a0-a79e-8703b99a2f30', {
      cwd: '/work',
    })).toBe("codex -c 'hooks={path=\"~/.codexwinmux/hooks.json\"}' resume 019dcf1f-3a02-73a0-a79e-8703b99a2f30 --cd '/work'");
  });

  it('rejects invalid resume ids', () => {
    expect(() => buildCodexResumeCommand('last')).toThrow(/Invalid Codex thread ID/);
  });
});
