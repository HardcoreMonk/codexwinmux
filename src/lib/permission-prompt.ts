const OPTION_KEYWORDS = [
  'Yes', 'Yes,', 'No',
  'Accept', 'Decline',
  'Open System Settings', 'Try again',
  'Use this', 'Continue without',
  'Use session directory', 'Use current directory',
  // ink Select dialog keywords (Resume Return, Idle Return)
  'Resume from summary', 'Resume full session',
  'Continue this conversation', 'Send message as',
  "Don't ask me again",
];
const INDICATOR_RE = /^\s*(?:[❯›>]\s+)?(.+)$/;
const FOCUSED_RE = /^\s*[❯›>]\s+/;
const NUMBER_PREFIX_RE = /^\d+\.\s+/;
// 좁은 터미널에서 "2. Yes..."가 "2Yes..."로 렌더되는 wrap 아티팩트까지 허용하기 위해 period/space를 optional로 둠
const NUMBERED_LINE_RE = /^\s*([❯›>])?\s*(\d+)\.?\s*(\S.*)$/;
const MAX_COMMAND_PREVIEW_LENGTH = 80;

export type TApprovalPromptType = 'command' | 'file' | 'permission' | 'resume-directory' | 'conversation' | 'unknown';
export type TApprovalKind = 'allow' | 'deny' | 'trust' | 'directory' | 'input' | 'unknown';
export type TApprovalRiskLevel = 'low' | 'medium' | 'high' | 'unknown';

export interface IApprovalPromptMetadata {
  promptType: TApprovalPromptType;
  approvalKind: TApprovalKind;
  riskLevel: TApprovalRiskLevel;
  commandPreview: string | null;
  fileHints: string[];
  fallbackReason: null;
}

export interface IPermissionPromptParseResult {
  options: string[];
  focusedIndex: number;
  metadata: IApprovalPromptMetadata;
}

interface IParsedPermissionOptions {
  options: string[];
  focusedIndex: number;
  promptContext: string;
}

const stripPrefix = (o: string) => o.replace(NUMBER_PREFIX_RE, '');
const hasOption = (options: string[], prefix: string) =>
  options.some((o) => stripPrefix(o).startsWith(prefix));
const leadingSpaces = (line: string): number => line.match(/^\s*/)?.[0].length ?? 0;

export const createEmptyApprovalPromptMetadata = (): IApprovalPromptMetadata => ({
  promptType: 'unknown',
  approvalKind: 'unknown',
  riskLevel: 'unknown',
  commandPreview: null,
  fileHints: [],
  fallbackReason: null,
});

// tmux pane capture가 손상된 경우 원본 옵션 텍스트를 복원한다.
// - "Yescurrent status for this tab"처럼 다른 UI 영역이 뒤에 붙은 경우 "Yes"만 남김
// - "Yes, and don't ask: <cmd>"처럼 "again for" 구간이 유실된 경우 canonical 형태로 복원
//   (이미 canonical한 텍스트는 건드리지 않아 원본 따옴표 문자를 보존)
const DAMAGED_DONT_ASK_RE = /^(Yes,\s*and\s+don[\u2019']?t\s+ask)\s*:\s*(.+)$/;
const DAMAGED_CODEX_NO_TELL_RE = /^.{0,2}No,?.*(?:tell|Codex|differently)/i;
const DAMAGED_NO_RE = /^.{0,2}No(?:[,\s]|$)/i;

const normalizeOption = (text: string): string => {
  const damaged = text.match(DAMAGED_DONT_ASK_RE);
  if (damaged) return `${damaged[1]} again for: ${damaged[2].trim()}`;
  if (/^Yes(?![,\s]|$)/.test(text)) return 'Yes';
  if (DAMAGED_CODEX_NO_TELL_RE.test(text)) return 'No, and tell Codex what to do differently';
  if (DAMAGED_NO_RE.test(text)) return 'No';
  if (/^No(?![,\s]|$)/.test(text)) return 'No';
  return text;
};

const isKnownPromptPattern = (options: string[]): boolean => {
  if (options.length < 2) return false;
  return (hasOption(options, 'Yes') && hasOption(options, 'No'))
    || (hasOption(options, 'Accept') && hasOption(options, 'Decline'))
    || hasOption(options, 'Open System Settings')
    || (hasOption(options, 'Use this') && hasOption(options, 'Continue without'))
    || (hasOption(options, 'Use session directory') && hasOption(options, 'Use current directory'))
    || (hasOption(options, 'Resume from summary') && hasOption(options, 'Resume full session'))
    || (hasOption(options, 'Continue this conversation') && hasOption(options, 'Send message as'));
};

const truncatePreview = (value: string): string =>
  value.length > MAX_COMMAND_PREVIEW_LENGTH
    ? value.slice(0, MAX_COMMAND_PREVIEW_LENGTH).trimEnd()
    : value;

const sanitizeSensitiveText = (value: string): string => value
  .replace(/Authorization:\s*Bearer\s+(?:\\?["'][^"']*\\?["']|[^"'\s)]+)/gi, 'Authorization: Bearer [redacted]')
  .replace(/x-cmux-token(?:\s*[:=]\s*|\s+)(?:\\?["'][^"']*\\?["']|[^"'\s)]+)/gi, 'x-cmux-token [redacted]')
  .replace(/\b([A-Z0-9_]*(?:TOKEN|API_KEY|PASSWORD|SECRET|ACCESS_KEY|PRIVATE_KEY)[A-Z0-9_]*|password|secret)=("[^"]*"|'[^']*'|[^"'\s)]+)/gi, '$1=[redacted]')
  .replace(/--token(?:\s*[:=]\s*|\s+)(?:\\?["'][^"']*\\?["']|[^"'\s)]+)/gi, '--token [redacted]')
  .replace(/\btoken(?:\s*:\s*|\s+)(?:\\?["'][^"']*\\?["']|[^"'\s)]+)/gi, 'token [redacted]')
  .replace(/\btoken=([^&\s"')]+)/gi, 'token=[redacted]')
  .replace(/(["']?token["']?\s*:\s*["'])[^"']+(["'])/gi, '$1[redacted]$2')
  .replace(/~\/\.codexwinmux\/cli-token\b/g, '[redacted-token-file]')
  .replace(/\b(cwd|sessionName|prompt|assistantText|terminalOutput)\s*[:=]\s*("[^"]*"|'[^']*'|[^\s,)]+)/g, '$1=[redacted]')
  .replace(/\b[A-Za-z]:\\[^\s"'`),]+/g, '[path]')
  .replace(/(^|[\s('"=])\/(?!\/)[^\s"'`),]+/g, '$1[path]')
  .replace(/\S+\.jsonl\b/g, '[jsonl]');

const extractCommandPreview = (options: string[]): string | null => {
  for (const option of options) {
    const text = stripPrefix(option);
    const command = text.match(/for commands that start with\s+`([^`]+)`/i)?.[1]
      ?? text.match(/\bfor:\s*(.+?)(?:\s+\([a-z]\))?$/i)?.[1]
      ?? text.match(/`([^`]+)`/)?.[1];

    if (command) return truncatePreview(sanitizeSensitiveText(command.trim()));
  }

  return null;
};

const extractRawCommandText = (options: string[]): string => options
  .map((option) => {
    const text = stripPrefix(option);
    return text.match(/for commands that start with\s+`([^`]+)`/i)?.[1]
      ?? text.match(/\bfor:\s*(.+?)(?:\s+\([a-z]\))?$/i)?.[1]
      ?? text.match(/`([^`]+)`/)?.[1]
      ?? text;
  })
  .join('\n');

const extractAbsolutePaths = (value: string): string[] => {
  const unixPaths = value.match(/\/(?!\/)[^\s"'`),]+/g) ?? [];
  const windowsPaths = value.match(/\b[A-Za-z]:\\[^\s"'`),]+/g) ?? [];
  return [...unixPaths, ...windowsPaths];
};

const basenameFromPath = (value: string): string => {
  const normalized = value.replace(/\\/g, '/');
  return normalized.split('/').filter(Boolean).at(-1) ?? normalized;
};

const extractFileHints = (paneContent: string): string[] => {
  const hints: string[] = [];
  for (const absolutePath of extractAbsolutePaths(paneContent)) {
    const basename = basenameFromPath(absolutePath);
    if (!basename || basename.endsWith('.jsonl') || hints.includes(basename)) continue;
    hints.push(basename);
    if (hints.length >= 3) break;
  }
  return hints;
};

const hasDestructiveCommandKeyword = (value: string): boolean =>
  /\b(rm\s+-rf|mkfs|dd\s+if=|shutdown|reboot|chmod\s+-R|chown\s+-R|killall|pkill)(?=\b|[^\w])/i.test(value);

const optionTextIncludes = (options: string[], pattern: RegExp): boolean =>
  options.some((option) => pattern.test(option));

const classifyApprovalKind = (promptType: TApprovalPromptType, options: string[]): TApprovalKind => {
  if (promptType === 'resume-directory') return 'directory';
  if (promptType === 'conversation') return 'input';
  if (promptType === 'permission') return 'trust';
  if (promptType === 'command' || promptType === 'file') {
    if (optionTextIncludes(options, /\bNo\b/i) && !optionTextIncludes(options, /\bYes\b/i)) return 'deny';
    return 'allow';
  }
  return 'unknown';
};

const classifyRiskLevel = (
  promptType: TApprovalPromptType,
  promptContext: string,
  options: string[],
  commandPreview: string | null,
): TApprovalRiskLevel => {
  const optionText = `${promptContext}\n${options.join('\n')}`;
  const rawCommandText = extractRawCommandText(options);
  if ((promptType === 'permission' && /bypass permissions/i.test(optionText))
    || /Yes,\s*and\s+don[\u2019']?t\s+ask\s+again/i.test(optionText)
    || hasDestructiveCommandKeyword(rawCommandText)
    || hasDestructiveCommandKeyword(commandPreview ?? optionText)) {
    return 'high';
  }
  if (promptType === 'resume-directory' || promptType === 'conversation') return 'low';
  if (promptType === 'command' || promptType === 'file' || promptType === 'permission') return 'medium';
  return 'unknown';
};

const classifyPromptType = (
  paneContent: string,
  options: string[],
  commandPreview: string | null,
  fileHints: string[],
): TApprovalPromptType => {
  const optionText = options.map(stripPrefix).join('\n');
  const combined = `${paneContent}\n${optionText}`;

  if (hasOption(options, 'Use session directory') && hasOption(options, 'Use current directory')) return 'resume-directory';
  if ((hasOption(options, 'Continue this conversation') && hasOption(options, 'Send message as'))
    || (hasOption(options, 'Resume from summary') && hasOption(options, 'Resume full session'))) return 'conversation';
  if ((hasOption(options, 'Accept') && hasOption(options, 'Decline'))
    || hasOption(options, 'Open System Settings')
    || /bypass permissions|open system settings|sandbox|trust this workspace/i.test(combined)) return 'permission';
  if (commandPreview || /run the following command|for commands that start with/i.test(combined)) return 'command';
  if (fileHints.length > 0 || /\b(edit|write|read|modify|open)\b.+\/[^\s"'`),]+/i.test(combined)) return 'file';
  return 'unknown';
};

const createApprovalPromptMetadata = (promptContext: string, options: string[]): IApprovalPromptMetadata => {
  const commandPreview = extractCommandPreview(options);
  const fileHints = extractFileHints(promptContext);
  const promptType = classifyPromptType(promptContext, options, commandPreview, fileHints);
  const metadata: IApprovalPromptMetadata = {
    promptType,
    approvalKind: classifyApprovalKind(promptType, options),
    riskLevel: classifyRiskLevel(promptType, promptContext, options, commandPreview),
    commandPreview,
    fileHints: promptType === 'file' ? fileHints : [],
    fallbackReason: null,
  };

  return metadata;
};

const collectPromptContext = (lines: string[], startIndex: number): string => {
  const context: string[] = [];
  for (let i = startIndex - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (NUMBERED_LINE_RE.test(line) || FOCUSED_RE.test(line)) break;
    if (line.trim()) context.unshift(line.trim());
    if (context.length >= 6) break;
  }
  return context.join('\n');
};

const parseNumberedOptions = (lines: string[]): IParsedPermissionOptions => {
  // 스크롤백에 이전 프롬프트 블록이 남아있는 경우 마지막 블록을 선택한다
  const blocks: { rawOptions: string[]; focusedIndex: number; promptContext: string }[] = [];
  let rawOptions: string[] = [];
  let focusedIndex = 0;
  let expected = 1;
  let lastOptionIndent = 0;
  let blockStartIndex = 0;

  const flush = () => {
    if (rawOptions.length >= 2) {
      blocks.push({
        rawOptions: rawOptions.slice(),
        focusedIndex,
        promptContext: collectPromptContext(lines, blockStartIndex),
      });
    }
    rawOptions = [];
    focusedIndex = 0;
    expected = 1;
    lastOptionIndent = 0;
    blockStartIndex = 0;
  };

  for (const [lineIndex, line] of lines.entries()) {
    // 손상된 pane capture에서 옵션 사이에 빈 줄이 끼어 있을 수 있으므로 break하지 않고 계속 탐색
    if (!line.trim()) continue;

    const match = line.match(NUMBERED_LINE_RE);
    if (match) {
      const marker = match[1];
      const num = Number(match[2]);
      const rest = match[3].trim();
      if (rest.length > 0) {
        if (num === 1) {
          flush();
          blockStartIndex = lineIndex;
          rawOptions.push(rest);
          if (marker) focusedIndex = 0;
          lastOptionIndent = leadingSpaces(line);
          expected = 2;
          continue;
        }
        if (num === expected) {
          if (marker) focusedIndex = rawOptions.length;
          rawOptions.push(rest);
          lastOptionIndent = leadingSpaces(line);
          expected += 1;
          continue;
        }
      }
    }

    if (rawOptions.length > 0) {
      // 긴 옵션이 터미널 width를 초과해 soft-wrap된 경우: 연속 라인은 원본 옵션보다 더 깊이 들여쓰기됨
      if (leadingSpaces(line) > lastOptionIndent) {
        rawOptions[rawOptions.length - 1] += line.trimStart();
        continue;
      }
      if (/^\s+\S/.test(line)) continue;
      flush();
    }
  }
  flush();

  const best = blocks[blocks.length - 1];
  if (!best) return { options: [], focusedIndex: 0, promptContext: '' };

  return {
    options: best.rawOptions.map((raw, i) => `${i + 1}. ${normalizeOption(raw)}`),
    focusedIndex: best.focusedIndex,
    promptContext: best.promptContext,
  };
};

const parseKeywordOptions = (lines: string[]): IParsedPermissionOptions => {
  const options: string[] = [];
  let focusedIndex = 0;
  let foundFirst = false;
  let firstOptionIndex = 0;

  for (const [lineIndex, line] of lines.entries()) {
    if (!line.trim()) {
      if (foundFirst) break;
      continue;
    }

    const isFocused = FOCUSED_RE.test(line);
    const isIndented = /^\s+\S/.test(line);

    if (!isFocused && !isIndented) {
      if (foundFirst) break;
      continue;
    }

    const match = line.match(INDICATOR_RE);
    if (!match) continue;
    const label = match[1].trim();
    const stripped = stripPrefix(label);
    const isKeyword = OPTION_KEYWORDS.some((kw) => stripped.startsWith(kw));

    if (isKeyword) {
      if (!foundFirst) firstOptionIndex = lineIndex;
      if (isFocused) focusedIndex = options.length;
      options.push(label);
      foundFirst = true;
    }
  }

  return { options, focusedIndex, promptContext: collectPromptContext(lines, firstOptionIndex) };
};

export const parsePermissionOptions = (paneContent: string): IPermissionPromptParseResult => {
  const lines = paneContent.split('\n');

  const numbered = parseNumberedOptions(lines);
  if (numbered.options.length >= 2 && isKnownPromptPattern(numbered.options)) {
    return {
      options: numbered.options,
      focusedIndex: numbered.focusedIndex,
      metadata: createApprovalPromptMetadata(numbered.promptContext, numbered.options),
    };
  }

  const keyword = parseKeywordOptions(lines);
  if (!isKnownPromptPattern(keyword.options)) {
    return {
      options: [],
      focusedIndex: 0,
      metadata: createEmptyApprovalPromptMetadata(),
    };
  }
  return {
    options: keyword.options,
    focusedIndex: keyword.focusedIndex,
    metadata: createApprovalPromptMetadata(keyword.promptContext, keyword.options),
  };
};

export const hasPermissionPrompt = (paneContent: string): boolean =>
  parsePermissionOptions(paneContent).options.length > 0;
