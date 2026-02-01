import pino from 'pino';
import type { LoggerOptions, Logger } from 'pino';
import { resolveLogLevel } from './level';
import { resolveBase } from './base';
import { resolveLogFormat, resolveTransport } from './format';
import type { LogFormat } from './format';

export interface CreateLoggerOptions {
  level?: string;
  /** @deprecated Use `format` instead */
  json?: boolean;
  /** Log format: 'json', 'logfmt', or 'pretty' */
  format?: LogFormat;
  name?: string;
  pinoOptions?: LoggerOptions;
}

export function createLogger(options: CreateLoggerOptions = {}): Logger {
  const level = resolveLogLevel(options.level);
  const format = resolveLogFormat(options.format ?? options.json);
  const transport = resolveTransport(format);
  const base = resolveBase();

  const opts: LoggerOptions = {
    level,
    ...(base !== undefined ? { base } : {}),
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label.toUpperCase() }),
    },
    ...options.pinoOptions,
  };

  if (options.name) {
    opts.name = options.name;
  }

  if (transport) {
    opts.transport = transport;
  }

  return pino(opts);
}
