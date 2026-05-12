import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { createReadStream } from 'fs';
import readline from 'readline';
import { execFile } from 'child_process';
import { randomUUID } from 'crypto';
import { getShellPath } from '@/lib/preflight';
import { normalizeLocale } from '@/lib/locales';
import { collectJsonlFiles } from './stats-cache';
import type { IDailyReportDay } from '@/types/stats';

const CACHE_DIR = path.join(os.homedir(), '.codexwinmux', 'stats', 'daily-reports');

// --- Cache read/write ---

export const readAllCachedReports = async (): Promise<Record<string, IDailyReportDay>> => {
  const result: Record<string, IDailyReportDay> = {};
  try {
    const files = await fs.readdir(CACHE_DIR);
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const content = await fs.readFile(path.join(CACHE_DIR, file), 'utf-8');
        const data = JSON.parse(content) as IDailyReportDay;
        if (data.date && data.brief) {
          result[data.date] = data;
        }
      } catch {
        // skip malformed files
      }
    }
  } catch {
    // directory doesn't exist yet
  }
  return result;
};

const writeCachedReport = async (report: IDailyReportDay): Promise<void> => {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(
    path.join(CACHE_DIR, `${report.date}.json`),
    JSON.stringify(report, null, 2),
    'utf-8',
  );
};

// --- Session data extraction ---

interface ISessionData {
  project: string;
  start: string;
  msgCount: number;
  toolCount: number;
  firstMessage: string;
}

export const shortenCwd = (cwd: string): string => {
  const home = os.homedir();
  const rel = cwd.startsWith(home) ? cwd.slice(home.length + 1) : cwd;
  return rel
    .replace(/^Workspace\/github\.com\//g, '')
    .replace(/^Workspace\/gitlab\.kolonfnc\.com\//g, 'gitlab/')
    .replace(/^Documents\//g, 'docs/')
    .replace(/^Downloads/g, 'Downloads');
};

const extractSessionsForDate = async (targetDate: string): Promise<ISessionData[]> => {
  const files = await collectJsonlFiles();
  const sessions: ISessionData[] = [];

  for (const filePath of files) {
    const userMessages: { time: string; text: string }[] = [];
    const timestamps: string[] = [];
    let toolCount = 0;
    let cwd = '';

    try {
      const stream = createReadStream(filePath, { encoding: 'utf-8' });
      const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

      for await (const line of rl) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line) as Record<string, unknown>;
          const ts = String(entry.timestamp ?? '');
          if (!ts.startsWith(targetDate)) continue;

          timestamps.push(ts);
          const type = String(entry.type ?? '');

          if (!cwd && typeof entry.cwd === 'string') {
            cwd = entry.cwd;
          }
          const payload = typeof entry.payload === 'object' && entry.payload !== null
            ? entry.payload as Record<string, unknown>
            : null;

          if (
            (type === 'session_meta' || type === 'turn_context')
            && payload
            && !cwd
            && typeof payload.cwd === 'string'
          ) {
            cwd = payload.cwd;
          }

          if (type === 'event_msg' && payload && payload.type === 'user_message') {
            const text = String(payload.message ?? '').slice(0, 300);
            if (
              text.trim()
              && !text.includes('<environment_context>')
              && !text.includes('<task-notification>')
            ) {
              userMessages.push({ time: ts.slice(11, 16), text: text.slice(0, 200) });
            }
          }

          if (type === 'response_item' && payload && payload.type === 'function_call') {
            toolCount++;
          }

          if (type === 'user') {
            const message = entry.message as Record<string, unknown> | undefined;
            if (!message) continue;
            const content = message.content;
            let text = '';

            if (typeof content === 'string') {
              text = content.slice(0, 300);
            } else if (Array.isArray(content)) {
              const texts: string[] = [];
              for (const c of content) {
                if (typeof c === 'object' && c !== null && (c as Record<string, unknown>).type === 'text') {
                  texts.push(String((c as Record<string, unknown>).text ?? '').slice(0, 300));
                }
              }
              text = texts.join(' | ');
            }

            if (text.includes('<command-message>')) {
              const match = text.match(/<command-name>\/([^<]+)<\/command-name>/);
              text = `[Command: ${match ? match[1] : 'unknown'}]`;
            }
            if (text.includes('<local-command-caveat>') || text.includes('<task-notification>')) {
              continue;
            }
            if (text.trim()) {
              userMessages.push({ time: ts.slice(11, 16), text: text.slice(0, 200) });
            }
          }

          if (type === 'assistant') {
            const message = entry.message as Record<string, unknown> | undefined;
            if (!message) continue;
            const content = message.content as unknown[];
            if (Array.isArray(content)) {
              toolCount += content.filter(
                (c) => typeof c === 'object' && c !== null && (c as Record<string, unknown>).type === 'tool_use',
              ).length;
            }
          }
        } catch {
          // skip malformed lines
        }
      }
    } catch {
      // file read error
    }

    if (timestamps.length > 0 && userMessages.length > 0) {
      const project = cwd ? shortenCwd(cwd) : path.basename(path.dirname(filePath));
      sessions.push({
        project,
        start: Math.min(...timestamps.map((t) => new Date(t).getTime())).toString(),
        msgCount: userMessages.length,
        toolCount,
        firstMessage: userMessages[0].text,
      });
    }
  }

  sessions.sort((a, b) => Number(a.start) - Number(b.start));
  return sessions;
};

// --- Codex CLI summary generation ---

const buildPromptData = (sessions: ISessionData[]): string => {
  return sessions
    .map((s) => {
      const time = new Date(Number(s.start)).toTimeString().slice(0, 5);
      return `[${time}] [${s.project}] msgs=${s.msgCount}, tools=${s.toolCount} | ${s.firstMessage}`;
    })
    .join('\n');
};

export const buildDailyReportCodexExecArgs = (outputPath: string): string[] => [
  'exec',
  '--skip-git-repo-check',
  '--ephemeral',
  '--sandbox',
  'read-only',
  '--color',
  'never',
  '--output-last-message',
  outputPath,
  '-',
];

export const resolveDailyReportCodexCwd = (): string =>
  process.env.__CMUX_APP_DIR || process.cwd();

const callCodexCli = async (input: string, systemPrompt: string): Promise<string> => {
  const resolvedPath = await getShellPath();
  const outputPath = path.join(os.tmpdir(), `codexmux-daily-report-${process.pid}-${randomUUID()}.txt`);

  return new Promise((resolve, reject) => {
    const child = execFile(
      'codex',
      buildDailyReportCodexExecArgs(outputPath),
      {
        cwd: resolveDailyReportCodexCwd(),
        timeout: 180_000,
        maxBuffer: 1024 * 1024,
        env: { ...process.env, PATH: resolvedPath },
      },
      (error, stdout, stderr) => {
        if (error) {
          void fs.unlink(outputPath).catch(() => {});
          reject(new Error(`codex exec failed: ${error.message}${stderr ? `\n${stderr}` : ''}`));
          return;
        }

        void fs.readFile(outputPath, 'utf-8')
          .then((content) => resolve(content.trim() || stdout.trim()))
          .catch(() => resolve(stdout.trim()))
          .finally(() => {
            void fs.unlink(outputPath).catch(() => {});
          });
      },
    );
    child.stdin?.write(`${systemPrompt}\n\n${input}`);
    child.stdin?.end();
  });
};

const LOCALE_LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  ko: 'Korean (한국어)',
};

const resolveLanguageName = (locale: string): string =>
  LOCALE_LANGUAGE_NAMES[locale] ?? LOCALE_LANGUAGE_NAMES.en;

const SUMMARY_PROMPT = (date: string, locale: string) => {
  const languageName = resolveLanguageName(locale);
  return `Summarize the Codex session history for ${date}.

Output format (use exactly this structure):

[BRIEF]
A 2-3 line summary of the entire day. Use terse noun-form phrases. Plain text only. No markdown headings (#) or separators (---).

[DETAIL]
## Project Name
### Major Feature / Area
- One-line task summary
- One-line task summary
### Another Feature / Area
- One-line task summary

Rules:
- The [BRIEF] and [DETAIL] tags must each appear exactly once, at the start of a line.
- Do not insert meta text outside the tags (separators, numbering, explanations).
- Always include the "## Project Name" heading, even when there is only one project.
- Each item is a single line — no filenames, no code snippets.
- Use terse noun-form phrases (e.g. "Fix login logic", "Improve mobile layout"). Avoid finished-sentence / past-tense forms.
- Focus on WHAT, not HOW.
- Skip trivial chatter (greetings, one-off questions, commit commands).
- Do not run tools or inspect files. Use only the data below.
- IMPORTANT: Write ALL brief and detail content in ${languageName}. Keep the [BRIEF] / [DETAIL] tags and markdown syntax (##, ###, -) as-is in English.

Data:`;
};

const stripTrailingMarkdownNoise = (text: string): string =>
  text.replace(/[\s#\-]*$/, '').trim();

const parseSummaryResponse = (response: string): { brief: string; detail: string } => {
  const briefMatch = response.match(/\[BRIEF\]\s*\n([\s\S]*?)(?=\[DETAIL\])/);
  const detailMatch = response.match(/\[DETAIL\]\s*\n([\s\S]*?)$/);

  return {
    brief: briefMatch ? stripTrailingMarkdownNoise(briefMatch[1]) : response.slice(0, 500),
    detail: detailMatch ? detailMatch[1].trim() : '',
  };
};

// --- Public API ---

export const generateDailyReport = async (
  date: string,
  force = false,
  locale = 'en',
): Promise<IDailyReportDay> => {
  const resolvedLocale = normalizeLocale(locale);
  if (!force) {
    const existing = await readCachedReport(date);
    if (existing && existing.locale === resolvedLocale) return existing;
  }

  const sessions = await extractSessionsForDate(date);
  if (sessions.length === 0) {
    const empty: IDailyReportDay = {
      date,
      brief: 'No activity recorded.',
      detail: '',
      generatedAt: new Date().toISOString(),
      locale: resolvedLocale,
    };
    await writeCachedReport(empty);
    return empty;
  }

  const promptData = buildPromptData(sessions);
  const response = await callCodexCli(promptData, SUMMARY_PROMPT(date, resolvedLocale));
  const { brief, detail } = parseSummaryResponse(response);

  const report: IDailyReportDay = {
    date,
    brief,
    detail,
    generatedAt: new Date().toISOString(),
    locale: resolvedLocale,
  };

  await writeCachedReport(report);
  return report;
};

export const readCachedReport = async (date: string): Promise<IDailyReportDay | null> => {
  try {
    const content = await fs.readFile(path.join(CACHE_DIR, `${date}.json`), 'utf-8');
    const data = JSON.parse(content) as IDailyReportDay;
    return data.date && data.brief ? data : null;
  } catch {
    return null;
  }
};
