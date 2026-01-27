import pino from 'pino';
import type { LoggerOptions, Logger } from 'pino';
import { resolveLogLevel } from './level';

export interface CreateLoggerOptions {
  level?: string;
  json?: boolean;
  name?: string;
  pinoOptions?: LoggerOptions;
}

function isJsonOutput(override?: boolean): boolean {
  if (override !== undefined) return override;
  return process.env.LOG_FORMAT === 'json';
}

export function createLogger(options: CreateLoggerOptions = {}): Logger {
  const level = resolveLogLevel(options.level);
  const json = isJsonOutput(options.json);

  const opts: LoggerOptions = {
    level,
    formatters: {
      level: (label) => ({ level: label.toUpperCase() }),
    },
    ...options.pinoOptions,
  };

  if (options.name) {
    opts.name = options.name;
  }

  if (!json) {
    opts.transport = {
      target: 'pino-pretty',
      options: { singleLine: true },
    };
  }

  return pino(opts);
}
