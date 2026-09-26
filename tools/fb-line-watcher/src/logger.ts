import pino, { type Logger as PinoLogger } from 'pino';
import pretty from 'pino-pretty';
import { ensureDir } from './util/fs.js';
import path from 'node:path';

export type Logger = PinoLogger;

/** 已註冊的秘密值；任何日誌字串中出現都會被替換 */
const secrets = new Set<string>();

export function registerSecret(value: string | undefined): void {
  if (value && value.length >= 6) secrets.add(value);
}

export function clearSecretsForTest(): void {
  secrets.clear();
}

const PATTERNS: [RegExp, string][] = [
  [/(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/g, '$1[REDACTED]'],
  [/((?:^|[;\s])(?:c_user|xs|datr|fr|sb)=)[^;\s]+/gi, '$1[REDACTED]'],
  [/\b[CUR][0-9a-f]{32}\b/g, '[LINE_ID_REDACTED]'],
];

export function redactString(input: string): string {
  let s = input;
  for (const sec of secrets) {
    if (s.includes(sec)) s = s.split(sec).join('[REDACTED]');
  }
  for (const [re, rep] of PATTERNS) s = s.replace(re, rep);
  return s;
}

const SENSITIVE_KEYS = /^(authorization|cookie|set-cookie|token|accesstoken|access_token|channelsecret|channel_secret|secretaccesskey|secret_access_key|password|pass)$/i;

export function deepRedact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[depth]';
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) return value.map((v) => deepRedact(v, depth + 1));
  if (value instanceof Error) {
    return { type: value.name, message: redactString(value.message), stack: value.stack ? redactString(value.stack) : undefined };
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEYS.test(k) ? '[REDACTED]' : deepRedact(v, depth + 1);
    }
    return out;
  }
  return value;
}

export interface LoggerOptions {
  level?: string;
  pretty?: boolean;
  logDir?: string;
  /** 測試用：改寫到這個 stream */
  stream?: NodeJS.WritableStream;
  fileStamp?: string;
}

export function createLogger(opts: LoggerOptions = {}): Logger {
  const level = opts.level ?? process.env.LOG_LEVEL ?? 'info';
  const streams: pino.StreamEntry[] = [];
  if (opts.stream) {
    streams.push({ level: level as pino.Level, stream: opts.stream });
  } else {
    const usePretty = opts.pretty ?? process.env.LOG_PRETTY === '1';
    streams.push({
      level: level as pino.Level,
      stream: usePretty
        ? pretty({ colorize: true, translateTime: 'SYS:yyyy-mm-dd HH:MM:ss', ignore: 'pid,hostname' })
        : process.stdout,
    });
    if (opts.logDir) {
      ensureDir(opts.logDir);
      const stamp = opts.fileStamp ?? new Date().toISOString().slice(0, 10);
      streams.push({ level: level as pino.Level, stream: pino.destination({ dest: path.join(opts.logDir, `watcher-${stamp}.log`), sync: false, mkdir: true }) });
    }
  }
  return pino(
    {
      level,
      base: undefined,
      timestamp: pino.stdTimeFunctions.isoTime,
      hooks: {
        logMethod(args, method) {
          const redacted = args.map((a) => deepRedact(a)) as Parameters<typeof method>;
          method.apply(this, redacted);
        },
      },
    },
    pino.multistream(streams),
  );
}
