import pino from 'pino';
import type { DestinationStream } from 'pino';
import pinoPretty from 'pino-pretty';

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
 * Resolves whether to include a timestamp in log messages.
 * Explicit override → LOG_TIMESTAMP env var → enabled by default.
 */
export function resolveTimestampEnabled(override?: boolean): boolean {
  if (override !== undefined) return override;

  const env = process.env.LOG_TIMESTAMP?.toLowerCase();
  return !(env === 'false' || env === '0' || env === 'off' || env === 'no');
}

/**
 * Resolves the Pino `timestamp` option: ISO time when enabled, `false` when not.
 */
export function resolveTimestamp(
  override?: boolean,
): typeof pino.stdTimeFunctions.isoTime | false {
  return resolveTimestampEnabled(override)
    ? pino.stdTimeFunctions.isoTime
    : false;
}

type LogObject = Record<string, unknown>;

/**
 * Stringify an object to logfmt format.
 */
function stringifyLogfmt(data: LogObject): string {
  let line = '';

  for (const key in data) {
    const raw = data[key];
    let value: string;

    if (raw == null) {
      value = '';
    } else {
      value = String(raw);
    }

    const hasNewlines = value.includes('\n') || value.includes('\r');
    const needsQuoting = value.includes(' ') || value.includes('=');
    const needsEscaping = value.includes('"') || value.includes('\\');

    // Escape backslashes and quotes first
    if (needsEscaping) value = value.replace(/["\\]/g, '\\$&');
    // Then escape newlines to keep log on single line
    if (hasNewlines) {
      value = value
        .replace(/\r\n/g, '\\n')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r');
    }
    if (needsQuoting || needsEscaping || hasNewlines) value = '"' + value + '"';
    if (value === '' && raw != null) value = '""';

    line += key + '=' + value + ' ';
  }

  return line.trimEnd();
}

/**
 * Flatten a nested object into a flat key-value object.
 */
function flattenObject(
  source: LogObject,
  separator = '_',
  prefixes: string[] = [],
): LogObject {
  const output: LogObject = {};

  for (const key in source) {
    const value = source[key];

    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      Object.assign(
        output,
        flattenObject(value as LogObject, separator, [...prefixes, key]),
      );
    } else {
      output[[...prefixes, key].join(separator)] = value;
    }
  }

  return output;
}

/**
 * Reorder object keys to: time, level, name, msg, ...rest
 */
function reorderKeys(obj: LogObject): LogObject {
  const { time, level, name, msg, ...rest } = obj;
  return {
    ...(time !== undefined && { time }),
    ...(level !== undefined && { level }),
    ...(name !== undefined && { name }),
    ...(msg !== undefined && { msg }),
    ...rest,
  };
}

/**
 * Create a logfmt destination stream.
 */
function createLogfmtStream(flattenNestedObjects: boolean): DestinationStream {
  return {
    write(chunk: string): void {
      try {
        let obj = JSON.parse(chunk) as LogObject;

        if (flattenNestedObjects) {
          obj = flattenObject(obj);
        }

        obj = reorderKeys(obj);

        process.stdout.write(stringifyLogfmt(obj) + '\n');
      } catch {
        // If parsing fails, write the raw chunk
        process.stdout.write(chunk);
      }
    },
  };
}

/**
 * Returns a destination stream for the given format.
 * Uses direct imports instead of transports to support standalone binaries.
 * Returns undefined for JSON (native pino output).
 */
export function resolveDestination(
  format: LogFormat,
  timestamp?: boolean,
): DestinationStream | undefined {
  const withTime = resolveTimestampEnabled(timestamp);

  switch (format) {
    case 'json':
      return undefined;
    case 'logfmt':
      return createLogfmtStream(resolveFlattenNestedObjects());
    case 'pretty':
      return pinoPretty({
        singleLine: true,
        ...(withTime ? {} : { ignore: 'time' }),
      });
  }
}

// Legacy export for backwards compatibility (deprecated)
// Note: This will still cause issues with standalone binaries
export function resolveTransport(
  format: LogFormat,
): { target: string; options: Record<string, unknown> } | undefined {
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
