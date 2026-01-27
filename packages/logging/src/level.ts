const PINO_LEVELS = new Set([
  'trace',
  'debug',
  'info',
  'warn',
  'error',
  'verbose',
]);

export function resolveLogLevel(override?: string): string {
  if (override) return override;

  const logLevel = process.env.LOG_LEVEL;
  const nodeEnv = process.env.NODE_ENV;

  if (logLevel && PINO_LEVELS.has(logLevel)) {
    return logLevel === 'verbose' ? 'trace' : logLevel;
  }

  if (!logLevel && nodeEnv === 'development') {
    return 'debug';
  }

  return 'info';
}
