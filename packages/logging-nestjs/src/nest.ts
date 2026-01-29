import type { IncomingMessage } from 'http';
import type { DynamicModule } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import {
  resolveLogLevel,
  resolveBase,
  resolveLogFormat,
  resolveTransport,
} from '@x1-labs/logging';
import type { CreateLoggerOptions } from '@x1-labs/logging';

export interface CreateNestLoggerModuleOptions extends CreateLoggerOptions {
  httpLogging?: boolean;
  forwardedIp?: boolean;
}

export function createNestLoggerModule(
  options: CreateNestLoggerModuleOptions = {},
): DynamicModule {
  const level = resolveLogLevel(options.level);
  const format = resolveLogFormat(options.format ?? options.json);
  const transport = resolveTransport(format);
  const httpLogging = options.httpLogging ?? true;
  const forwardedIp = options.forwardedIp ?? true;
  const base = resolveBase();

  const pinoHttp = {
    level,
    ...(base !== undefined ? { base } : {}),
    autoLogging: httpLogging,
    formatters: {
      level: (label: string) => ({ level: label.toUpperCase() }),
    },
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
    transport,
    ...options.pinoOptions,
  };

  return LoggerModule.forRoot({
    pinoHttp,
    renameContext: 'name',
  }) as DynamicModule;
}
