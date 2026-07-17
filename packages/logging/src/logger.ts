import pino from 'pino';
import type { LoggerOptions, Logger } from 'pino';
import { resolveLogLevel } from './level';
import { resolveBase } from './base';
import { serializeError } from './error';
import { resolveLogFormat, resolveDestination } from './format';
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
  const destination = resolveDestination(format);
  const base = resolveBase();

  const opts: LoggerOptions = {
    level,
    ...(base !== undefined ? { base } : {}),
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label.toUpperCase() }),
    },
    ...options.pinoOptions,
    serializers: {
      err: serializeError,
      ...options.pinoOptions?.serializers,
    },
  };

  if (options.name) {
    opts.name = options.name;
  }

  // Use destination stream if provided, otherwise use default stdout
  return destination ? pino(opts, destination) : pino(opts);
}
