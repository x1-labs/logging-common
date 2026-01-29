import build from 'pino-abstract-transport';

type LogObject = Record<string, unknown>;

export interface LogfmtTransportOptions {
  flattenNestedObjects?: boolean;
  flattenSeparator?: string;
}

/**
 * Stringify an object to logfmt format.
 */
function stringify(data: LogObject): string {
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
      value = value.replace(/\r\n/g, '\\n').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
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
 * Reorder object keys to: time, level, msg, ...rest
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
 * Custom logfmt transport with field ordering: time, level, msg, ...rest
 */
export default async function (opts: LogfmtTransportOptions = {}) {
  const { flattenNestedObjects, flattenSeparator = '_' } = opts;

  return build(async function (source) {
    for await (let obj of source) {
      if (flattenNestedObjects) {
        obj = flattenObject(obj as LogObject, flattenSeparator);
      }

      obj = reorderKeys(obj as LogObject);

      process.stdout.write(stringify(obj as LogObject) + '\n');
    }
  });
}
