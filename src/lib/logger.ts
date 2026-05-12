import pino from 'pino';
import path from 'path';
import { resolveCodexmuxLogDir } from '@/lib/host-paths';

const LOG_DIR = resolveCodexmuxLogDir();
const DEFAULT_LEVEL: pino.Level = (process.env.LOG_LEVEL as pino.Level) || 'info';

// LOG_LEVELS=status=debug,tmux=trace
const parseGroupLevels = (raw: string | undefined): Record<string, pino.Level> => {
  if (!raw) return {};
  const out: Record<string, pino.Level> = {};
  for (const part of raw.split(',')) {
    const [name, level] = part.split('=').map((s) => s.trim());
    if (name && level) out[name] = level as pino.Level;
  }
  return out;
};

const GROUP_LEVELS = parseGroupLevels(process.env.LOG_LEVELS);

const LEVEL_ORDER: pino.Level[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];

// 그룹별 child가 더 낮은 레벨을 통과시키려면 root가 그 레벨까지 열려 있어야 함
const lowestLevel = (): pino.Level => {
  const all: pino.Level[] = [DEFAULT_LEVEL, ...Object.values(GROUP_LEVELS)];
  return all.reduce((min, l) => (LEVEL_ORDER.indexOf(l) < LEVEL_ORDER.indexOf(min) ? l : min), 'fatal');
};

const g = globalThis as unknown as { __ptRootLogger?: pino.Logger };

if (!g.__ptRootLogger) {
  const rootLevel = lowestLevel();
  g.__ptRootLogger = pino({
    level: rootLevel,
    transport: {
      targets: [
        {
          target: 'pino-roll',
          level: rootLevel,
          options: {
            file: path.join(LOG_DIR, 'codexwinmux'),
            frequency: 'daily',
            dateFormat: 'yyyy-MM-dd',
            limit: { count: 7 },
            mkdir: true,
          },
        },
        {
          target: 'pino-pretty',
          level: rootLevel,
          options: {
            colorize: true,
            ignore: 'pid,hostname,module',
            translateTime: 'HH:MM:ss',
            messageFormat: '[{module}] {msg}',
          },
        },
      ],
    },
  });
}

const rootLogger = g.__ptRootLogger;

export const createLogger = (module: string): pino.Logger => {
  const child = rootLogger.child({ module });
  child.level = GROUP_LEVELS[module] ?? DEFAULT_LEVEL;
  return child;
};
