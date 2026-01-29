import type { TransportSingleOptions } from 'pino';

export type LogFormat = 'json' | 'logfmt' | 'pretty';

/**
 * Resolves the log format from explicit override or LOG_FORMAT env var.
 * - 'json': structured JSON output
 * - 'logfmt': key=value format, compatible with Loki/Grafana
 * - 'pretty': human-readable colored output (default)
 */
export function resolveLogFormat(override?: LogFormat | boolean): LogFormat {
  // Handle legacy boolean json option
  if (override === true) return 'json';
  if (override === false) return 'pretty';
  if (override !== undefined) return override;

  const envFormat = process.env.LOG_FORMAT?.toLowerCase();
  if (envFormat === 'json') return 'json';
  if (envFormat === 'logfmt') return 'logfmt';
  if (envFormat === 'pretty') return 'pretty';

  return 'pretty';
}

/**
 * Resolves whether to flatten nested objects in logfmt output.
 * Controlled by LOG_FLATTEN_NESTED env var. Enabled by default.
 */
export function resolveFlattenNestedObjects(): boolean {
  const env = process.env.LOG_FLATTEN_NESTED?.toLowerCase();
  return !(env === 'false' || env === '0');
}

/**
 * Returns the pino transport configuration for the given format.
 * Returns undefined for JSON (native pino output).
 */
export function resolveTransport(
  format: LogFormat,
): TransportSingleOptions | undefined {
  switch (format) {
    case 'json':
      return undefined;
    case 'logfmt':
      return {
        target: require.resolve('./logfmt-transport.js'),
        options: { flattenNestedObjects: resolveFlattenNestedObjects() },
      };
    case 'pretty':
      return {
        target: require.resolve('pino-pretty'),
        options: { singleLine: true },
      };
  }
}
