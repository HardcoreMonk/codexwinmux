import { describe, expect, it } from 'vitest';

import { hasPermissionPrompt, parsePermissionOptions } from '@/lib/permission-prompt';

describe('parsePermissionOptions', () => {
  it('numbered Yes/No 프롬프트에서 포커스된 옵션을 인식한다', () => {
    const pane = [
      'Do you want to proceed?',
      '',
      '❯ 1. Yes',
      '  2. No',
    ].join('\n');

    const result = parsePermissionOptions(pane);

    expect(result.options).toEqual(['1. Yes', '2. No']);
    expect(result.focusedIndex).toBe(0);
  });

  it('좁은 터미널에서 "2Yes"처럼 wrap된 라인도 파싱한다', () => {
    const pane = [
      'Permission required',
      '',
      '  1. Yes',
      '❯ 2Yes, and don\'t ask again',
      '  3. No',
    ].join('\n');

    const result = parsePermissionOptions(pane);

    expect(result.options).toHaveLength(3);
    expect(result.focusedIndex).toBe(1);
    expect(result.options[1]).toContain("Yes, and don't ask again");
  });

  it('알려지지 않은 패턴은 빈 옵션을 반환한다', () => {
    const pane = [
      'Some random output',
      '❯ Foo',
      '  Bar',
    ].join('\n');

    expect(parsePermissionOptions(pane)).toEqual({
      options: [],
      focusedIndex: 0,
      metadata: {
        promptType: 'unknown',
        approvalKind: 'unknown',
        riskLevel: 'unknown',
        commandPreview: null,
        fileHints: [],
        fallbackReason: null,
      },
    });
  });

  it('손상된 pane capture에서 옵션 텍스트를 복원한다', () => {
    const pane = [
      'Do you want to proceed?',
      ' ❯ 1. Yescurrent status for this tab',
      "  2.Yes, and don't ask: curl -s http://localhost:8122/api/status",
      '',
      '   3. No',
      ' Esc to cancel · Tab to amend · ctrl+e to explain',
    ].join('\n');

    const result = parsePermissionOptions(pane);

    expect(result.options).toEqual([
      '1. Yes',
      "2. Yes, and don't ask again for: curl -s http://localhost:8122/api/status",
      '3. No',
    ]);
    expect(result.focusedIndex).toBe(0);
  });

  it('Codex warning 출력이 끼어든 No 옵션을 복원한다', () => {
    const pane = [
      'Would you like to run the following command?',
      '  1. Yes, proceed (y)',
      "  2. Yes, and don't ask again for commands that start with `touch /tmp/codexmux-live-approval-smoke-1` (p)",
      '  3.tNo,mandetellpCodex whatstordordifferentlyn(esc)',
      'Press enter to confirm or esc to cancel',
    ].join('\n');

    const result = parsePermissionOptions(pane);

    expect(result.options).toEqual([
      '1. Yes, proceed (y)',
      "2. Yes, and don't ask again for commands that start with `touch /tmp/codexmux-live-approval-smoke-1` (p)",
      '3. No, and tell Codex what to do differently',
    ]);
  });

  it('terminal soft-wrap으로 다음 줄로 이어진 긴 옵션을 합친다', () => {
    const pane = [
      ' Do you want to proceed?',
      ' ❯ 1. Yes',
      "   2. Yes, and don\u2019t ask again for: python3 -c \"import sys,json; d=json.loads(sys.stdin.read()); print('type:',d.get('type'),'| timestamp:',d.get('timestamp'),'|",
      "                                  stop_reason:',d.get('message',{}).get('stop_reason'))\"",
      '   3. No',
    ].join('\n');

    const result = parsePermissionOptions(pane);

    expect(result.options).toEqual([
      '1. Yes',
      "2. Yes, and don\u2019t ask again for: python3 -c \"import sys,json; d=json.loads(sys.stdin.read()); print('type:',d.get('type'),'| timestamp:',d.get('timestamp'),'|stop_reason:',d.get('message',{}).get('stop_reason'))\"",
      '3. No',
    ]);
    expect(result.focusedIndex).toBe(0);
  });

  it('스크롤백에 이전 프롬프트가 남아있으면 가장 최근 블록을 선택한다', () => {
    const pane = [
      'Do you want to proceed?',
      ' ❯ 1. Yes',
      "   2. Yes, and don\u2019t ask again for: python3 -c \"import sys,json\"",
      '   3. No',
      '',
      '> running command...',
      'output line',
      '',
      'Do you want to proceed?',
      '   1. Yes',
      " ❯ 2. Yes, and don\u2019t ask again for tmux list-sessions",
      '   3. No',
    ].join('\n');

    const result = parsePermissionOptions(pane);

    expect(result.options).toHaveLength(3);
    expect(result.options[1]).toContain('tmux list-sessions');
    expect(result.focusedIndex).toBe(1);
  });

  it('keyword 기반 Accept/Decline 프롬프트를 인식한다', () => {
    const pane = [
      'Trust this workspace?',
      '',
      '❯ Accept',
      '  Decline',
    ].join('\n');

    const result = parsePermissionOptions(pane);

    expect(result.options).toEqual(['Accept', 'Decline']);
    expect(result.focusedIndex).toBe(0);
    expect(result.metadata.promptType).toBe('permission');
    expect(result.metadata.approvalKind).toBe('trust');
    expect(result.metadata.riskLevel).toBe('medium');
    expect(result.metadata.fallbackReason).toBeNull();
  });

  it('Bypass Permissions prompt metadata를 high risk permission으로 분류한다', () => {
    const pane = [
      'Bypass Permissions?',
      '',
      '❯ 1. Yes',
      '  2. No',
    ].join('\n');

    const result = parsePermissionOptions(pane);

    expect(result.metadata.promptType).toBe('permission');
    expect(result.metadata.approvalKind).toBe('trust');
    expect(result.metadata.riskLevel).toBe('high');
  });

  it('Open System Settings prompt metadata를 permission으로 분류한다', () => {
    const pane = [
      'Codex needs additional permission',
      '',
      '❯ Open System Settings',
      '  Try again',
    ].join('\n');

    const result = parsePermissionOptions(pane);

    expect(result.metadata.promptType).toBe('permission');
    expect(result.metadata.approvalKind).toBe('trust');
    expect(result.metadata.riskLevel).toBe('medium');
  });

  it('Codex resume working directory 선택 프롬프트를 인식한다', () => {
    const pane = [
      'Choose working directory to resume this session',
      '',
      '  Session = latest cwd recorded in the resumed session',
      '  Current = your current working directory',
      '',
      '› 1. Use session directory (/data/projects/codex-zone/purecvisor-single)',
      '  2. Use current directory (/home/hardcoremonk)',
      '',
      '  Press enter to continue',
    ].join('\n');

    const result = parsePermissionOptions(pane);

    expect(result.options).toEqual([
      '1. Use session directory (/data/projects/codex-zone/purecvisor-single)',
      '2. Use current directory (/home/hardcoremonk)',
    ]);
    expect(result.focusedIndex).toBe(0);
  });

  it('command approval prompt metadata를 안전하게 생성한다', () => {
    const pane = [
      'Would you like to run the following command?',
      '  1. Yes, proceed (y)',
      "❯ 2. Yes, and don't ask again for commands that start with `curl -H \"Authorization: Bearer secret\" -H \"x-cmux-token: abc\" \"http://localhost:8122/api/status?token=secret\" /data/projects/codexmux/package.json` (p)",
      '  3. No',
    ].join('\n');

    const result = parsePermissionOptions(pane);

    expect(result.metadata.promptType).toBe('command');
    expect(result.metadata.approvalKind).toBe('allow');
    expect(result.metadata.riskLevel).toBe('high');
    expect(result.metadata.fallbackReason).toBeNull();
    expect(result.metadata.commandPreview).toContain('curl');
    expect(result.metadata.commandPreview).not.toContain('secret');
    expect(result.metadata.commandPreview).not.toContain('/data/projects');
    expect(JSON.stringify(result.metadata)).not.toContain('secret');
    expect(JSON.stringify(result.metadata)).not.toContain('/data/projects');
  });

  it('command approval metadata에서 추가 민감 정보를 제거한다', () => {
    const panes = [
      "x-cmux-token=eq-secret",
      "x-cmux-token space-secret",
      '{"token":"json-secret"}',
      '~/.codexwinmux/cli-token',
      'C:\\Users\\bob\\secret.txt',
      '/data/projects/codexmux/sessions/secret.jsonl',
      'cwd=/data/projects/codexmux',
      'sessionName=secret-session',
      'prompt=secret-prompt',
      'assistantText=secret-assistant',
      'terminalOutput=secret-terminal',
    ].map((variant) => [
      'Would you like to run the following command?',
      '  1. Yes, proceed (y)',
      `❯ 2. Yes, and don't ask again for commands that start with \`curl ${variant}\` (p)`,
      '  3. No',
    ].join('\n'));

    const metadataText = panes
      .map((pane) => JSON.stringify(parsePermissionOptions(pane).metadata))
      .join('\n');

    expect(metadataText).toContain('curl');
    expect(metadataText).not.toContain('eq-secret');
    expect(metadataText).not.toContain('space-secret');
    expect(metadataText).not.toContain('json-secret');
    expect(metadataText).not.toContain('~/.codexwinmux/cli-token');
    expect(metadataText).not.toContain('C:\\Users\\bob\\secret.txt');
    expect(metadataText).not.toContain('/data/projects');
    expect(metadataText).not.toContain('secret.jsonl');
    expect(metadataText).not.toContain('secret-session');
    expect(metadataText).not.toContain('secret-prompt');
    expect(metadataText).not.toContain('secret-assistant');
    expect(metadataText).not.toContain('secret-terminal');
  });

  it('command approval metadata에서 plain token 형식을 제거한다', () => {
    const panes = [
      '--token dash-secret',
      'token plain-secret',
      'token: colon-secret',
    ].map((variant) => [
      'Would you like to run the following command?',
      '  1. Yes, proceed (y)',
      `❯ 2. Yes, and don't ask again for commands that start with \`curl ${variant}\` (p)`,
      '  3. No',
    ].join('\n'));

    const metadataText = panes
      .map((pane) => JSON.stringify(parsePermissionOptions(pane).metadata))
      .join('\n');

    expect(metadataText).toContain('curl');
    expect(metadataText).not.toContain('dash-secret');
    expect(metadataText).not.toContain('plain-secret');
    expect(metadataText).not.toContain('colon-secret');
  });

  it('command approval metadata에서 env-style secret assignments를 제거한다', () => {
    const panes = [
      'GITHUB_TOKEN=github-secret',
      'OPENAI_API_KEY=openai-secret',
      'ANTHROPIC_API_KEY=anthropic-secret',
      'password=password-secret',
      'secret=plain-secret',
    ].map((variant) => [
      'Would you like to run the following command?',
      '  1. Yes, proceed (y)',
      `❯ 2. Yes, and don't ask again for commands that start with \`curl ${variant}\` (p)`,
      '  3. No',
    ].join('\n'));

    const metadataText = panes
      .map((pane) => JSON.stringify(parsePermissionOptions(pane).metadata))
      .join('\n');

    expect(metadataText).toContain('curl');
    expect(metadataText).not.toContain('github-secret');
    expect(metadataText).not.toContain('openai-secret');
    expect(metadataText).not.toContain('anthropic-secret');
    expect(metadataText).not.toContain('password-secret');
    expect(metadataText).not.toContain('plain-secret');
  });

  it('command approval metadata에서 quoted and broad env secret assignments를 제거한다', () => {
    const panes = [
      'OPENAI_API_KEY="sk-secret"',
      "password='quoted-secret'",
      'DATABASE_PASSWORD=db-secret',
      'SECRET_KEY=key-secret',
      'AWS_ACCESS_KEY=access-secret',
      'SSH_PRIVATE_KEY=private-secret',
    ].map((variant) => [
      'Would you like to run the following command?',
      '  1. Yes, proceed (y)',
      `❯ 2. Yes, and don't ask again for commands that start with \`curl ${variant}\` (p)`,
      '  3. No',
    ].join('\n'));

    const metadataText = panes
      .map((pane) => JSON.stringify(parsePermissionOptions(pane).metadata))
      .join('\n');

    expect(metadataText).toContain('curl');
    expect(metadataText).not.toContain('sk-secret');
    expect(metadataText).not.toContain('quoted-secret');
    expect(metadataText).not.toContain('db-secret');
    expect(metadataText).not.toContain('key-secret');
    expect(metadataText).not.toContain('access-secret');
    expect(metadataText).not.toContain('private-secret');
  });

  it('command approval metadata에서 quoted header token 값을 제거한다', () => {
    const pane = [
      'Would you like to run the following command?',
      '  1. Yes, proceed (y)',
      '❯ 2. Yes, and don\'t ask again for commands that start with `curl -H "Authorization: Bearer \\"quoted-bearer\\"" -H "x-cmux-token \\"quoted-cmux\\"" /status` (p)',
      '  3. No',
    ].join('\n');

    const metadataText = JSON.stringify(parsePermissionOptions(pane).metadata);

    expect(metadataText).toContain('curl');
    expect(metadataText).not.toContain('quoted-bearer');
    expect(metadataText).not.toContain('quoted-cmux');
  });

  it('truncated preview 뒤의 destructive command도 high risk로 분류한다', () => {
    const longPrefix = 'a'.repeat(90);
    const pane = [
      'Would you like to run the following command?',
      `❯ 1. Yes, proceed for: printf ${longPrefix} && rm -rf /tmp/codexmux-danger`,
      '  2. No',
    ].join('\n');

    const result = parsePermissionOptions(pane);

    expect(result.metadata.promptType).toBe('command');
    expect(result.metadata.commandPreview).not.toContain('rm -rf');
    expect(result.metadata.riskLevel).toBe('high');
  });

  it('dd if= command를 high risk로 분류한다', () => {
    const pane = [
      'Would you like to run the following command?',
      '❯ 1. Yes, proceed for: dd if=/dev/zero of=/tmp/disk.img',
      '  2. No',
    ].join('\n');

    const result = parsePermissionOptions(pane);

    expect(result.metadata.promptType).toBe('command');
    expect(result.metadata.riskLevel).toBe('high');
  });

  it('이전 scrollback의 권한 문구와 파일 경로가 최신 unknown prompt metadata를 오염시키지 않는다', () => {
    const pane = [
      'Earlier output: Bypass Permissions',
      'Codex wants to edit /data/projects/codexmux/src/lib/old-secret.ts',
      '  1. Yes',
      '  2. No',
      '',
      'Some command output',
      '',
      'Do you want to proceed?',
      '❯ 1. Yes',
      '  2. No',
    ].join('\n');

    const result = parsePermissionOptions(pane);

    expect(result.options).toEqual(['1. Yes', '2. No']);
    expect(result.metadata.promptType).toBe('unknown');
    expect(result.metadata.riskLevel).toBe('unknown');
    expect(result.metadata.fileHints).toEqual([]);
    expect(JSON.stringify(result.metadata)).not.toContain('old-secret.ts');
    expect(JSON.stringify(result.metadata)).not.toContain('/data/projects');
  });

  it('file approval prompt metadata에 basename 힌트만 남긴다', () => {
    const pane = [
      'Codex wants to edit /data/projects/codexmux/src/lib/secret-file.ts',
      '',
      '❯ 1. Yes',
      '  2. No',
    ].join('\n');

    const result = parsePermissionOptions(pane);

    expect(result.metadata.promptType).toBe('file');
    expect(result.metadata.riskLevel).toBe('medium');
    expect(result.metadata.fileHints).toEqual(['secret-file.ts']);
    expect(JSON.stringify(result.metadata)).not.toContain('/data/projects');
  });

  it('resume directory prompt metadata는 절대 경로를 제거한다', () => {
    const pane = [
      'Choose working directory to resume this session',
      '',
      '› 1. Use session directory (/data/projects/codex-zone/codexmux)',
      '  2. Use current directory (/home/hardcoremonk)',
    ].join('\n');

    const result = parsePermissionOptions(pane);

    expect(result.metadata.promptType).toBe('resume-directory');
    expect(result.metadata.approvalKind).toBe('directory');
    expect(result.metadata.riskLevel).toBe('low');
    expect(result.metadata.fileHints).toEqual([]);
    expect(JSON.stringify(result.metadata)).not.toContain('/data/projects');
    expect(JSON.stringify(result.metadata)).not.toContain('/home/');
  });

  it('conversation prompt metadata를 생성한다', () => {
    const pane = [
      'How should Codex handle this message?',
      '',
      '❯ Continue this conversation',
      '  Send message as new prompt',
    ].join('\n');

    const result = parsePermissionOptions(pane);

    expect(result.options).toEqual(['Continue this conversation', 'Send message as new prompt']);
    expect(result.metadata.promptType).toBe('conversation');
    expect(result.metadata.approvalKind).toBe('input');
    expect(result.metadata.riskLevel).toBe('low');
  });

  it('resume conversation prompt metadata를 생성한다', () => {
    const pane = [
      'How should Codex resume?',
      '',
      '❯ Resume from summary',
      '  Resume full session',
    ].join('\n');

    const result = parsePermissionOptions(pane);

    expect(result.options).toEqual(['Resume from summary', 'Resume full session']);
    expect(result.metadata.promptType).toBe('conversation');
    expect(result.metadata.approvalKind).toBe('input');
    expect(result.metadata.riskLevel).toBe('low');
  });

  it('unknown Yes/No prompt metadata는 기본 unknown 값을 유지한다', () => {
    const pane = [
      'Do you want to proceed?',
      '',
      '❯ 1. Yes',
      '  2. No',
    ].join('\n');

    const result = parsePermissionOptions(pane);

    expect(result.options).toEqual(['1. Yes', '2. No']);
    expect(result.metadata).toEqual({
      promptType: 'unknown',
      approvalKind: 'unknown',
      riskLevel: 'unknown',
      commandPreview: null,
      fileHints: [],
      fallbackReason: null,
    });
  });
});

describe('hasPermissionPrompt', () => {
  it('유효한 프롬프트에서 true를 반환한다', () => {
    const pane = '\n❯ 1. Yes\n  2. No\n';
    expect(hasPermissionPrompt(pane)).toBe(true);
  });

  it('프롬프트가 없으면 false를 반환한다', () => {
    expect(hasPermissionPrompt('just some logs\nmore logs')).toBe(false);
  });
});
