import type { IncomingMessage } from 'http';
import type { DynamicModule } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { resolveLogLevel } from '@x1-labs/logging';
import type { CreateLoggerOptions } from '@x1-labs/logging';

export interface CreateNestLoggerModuleOptions extends CreateLoggerOptions {
  httpLogging?: boolean;
  forwardedIp?: boolean;
}

export function createNestLoggerModule(
  options: CreateNestLoggerModuleOptions = {},
): DynamicModule {
  const level = resolveLogLevel(options.level);
  const json = options.json ?? process.env.LOG_FORMAT === 'json';
  const httpLogging = options.httpLogging ?? true;
  const forwardedIp = options.forwardedIp ?? true;

  const pinoHttp = {
    level,
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
    transport: !json
      ? { target: 'pino-pretty', options: { singleLine: true } }
      : undefined,
    ...options.pinoOptions,
  };

  return LoggerModule.forRoot({ pinoHttp }) as DynamicModule;
}
