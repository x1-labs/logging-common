import pino from 'pino';
import type { LoggerOptions, Logger } from 'pino';
import { resolveLogLevel } from './level';

export type { CreateLoggerOptions } from './logger';

/**
 * Browser-safe createLogger.
 *
 * Pino's own package.json "browser" field swaps in pino/browser.js,
 * which maps log levels to console methods. We just avoid setting
 * Node-only options (transport, pino-pretty).
 */
export function createLogger(
  options: {
    level?: string;
    json?: boolean;
    name?: string;
    pinoOptions?: LoggerOptions;
  } = {},
): Logger {
  const level = resolveLogLevel(options.level);

  const opts: LoggerOptions = {
    level,
    browser: { asObject: true },
    formatters: {
      level: (label) => ({ level: label.toUpperCase() }),
    },
    ...options.pinoOptions,
  };

  if (options.name) {
    opts.name = options.name;
  }

  return pino(opts);
}
