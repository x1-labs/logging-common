import type { IncomingMessage } from 'http';
import pinoHttp from 'pino-http';
import type { Options as PinoHttpOptions, HttpLogger } from 'pino-http';
import {
  resolveLogLevel,
  resolveBase,
  resolveLogFormat,
  resolveDestination,
  resolveTimestamp,
  serializeError,
} from '@x1-labs/logging';
import type { CreateLoggerOptions } from '@x1-labs/logging';

export interface CreateExpressLoggerOptions extends CreateLoggerOptions {
  /** Enable automatic HTTP request/response logging (default: true) */
  autoLogging?: boolean;
  /** Extract client IP from x-forwarded-for header (default: true) */
  forwardedIp?: boolean;
  /** Additional pino-http options (merged last, can override everything) */
  pinoHttpOptions?: Partial<PinoHttpOptions>;
}

export function createExpressLogger(
  options: CreateExpressLoggerOptions = {},
): HttpLogger {
  const level = resolveLogLevel(options.level);
  const format = resolveLogFormat(options.format ?? options.json);
  const destination = resolveDestination(format, options.timestamp);
  const autoLogging = options.autoLogging ?? true;
  const forwardedIp = options.forwardedIp ?? true;
  const base = resolveBase();

  const httpOptions: PinoHttpOptions = {
    level,
    ...(base !== undefined ? { base } : {}),
    autoLogging,
    timestamp: resolveTimestamp(options.timestamp),
    formatters: {
      level: (label: string) => ({ level: label.toUpperCase() }),
    },
    ...(options.name ? { name: options.name } : {}),
    ...(forwardedIp
      ? {
          customProps: (req: IncomingMessage) => ({
            ip:
              (req.headers['x-forwarded-for'] as string | undefined)
                ?.split(',')[0]
                ?.trim() ?? req.socket?.remoteAddress,
          }),
        }
      : {}),
    ...options.pinoOptions,
    ...options.pinoHttpOptions,
    serializers: {
      err: serializeError,
      ...options.pinoOptions?.serializers,
      ...options.pinoHttpOptions?.serializers,
    },
  };

  return pinoHttp(httpOptions, destination);
}
