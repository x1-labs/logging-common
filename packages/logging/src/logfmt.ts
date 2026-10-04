export type LogObject = Record<string, unknown>;

export interface LogfmtOptions {
  flattenNestedObjects?: boolean;
  flattenSeparator?: string;
}

/**
 * Format a log record as one logfmt line.
 * Key order: time, level, name, msg, ...rest
 */
export function formatLogfmt(
  record: LogObject,
  { flattenNestedObjects, flattenSeparator = '_' }: LogfmtOptions = {},
): string {
  const fields = flattenNestedObjects
    ? flattenObject(record, flattenSeparator)
    : record;
  return stringifyLogfmt(reorderKeys(fields));
}

/**
 * Stringify an object to logfmt format.
 */
export function stringifyLogfmt(data: LogObject): string {
  let line = '';

  for (const key in data) {
    const raw = data[key];
    let value = toText(raw);

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
 * Write a field value as text. This never throws.
 * An object, or an array that contains an object, becomes compact JSON.
 * Other values keep their String() form. Thus an array of primitives stays
 * comma-joined.
 */
function toText(raw: unknown): string {
  if (raw == null) return '';
  try {
    if (typeof raw !== 'object' || !containsObject(raw)) return String(raw);
    return JSON.stringify(raw, jsonReplacer()) ?? '';
  } catch {
    return '[Unserializable]';
  }
}

function containsObject(value: object): boolean {
  return (
    !Array.isArray(value) ||
    value.some((item) => typeof item === 'object' && item !== null)
  );
}

/**
 * Make a JSON.stringify replacer for values that JSON cannot write as they are.
 * A BigInt becomes a string. A reference back to an ancestor becomes
 * "[Circular]". An Error becomes its name, message and code.
 */
function jsonReplacer() {
  const ancestors: unknown[] = [];

  return function (this: unknown, _key: string, value: unknown): unknown {
    if (typeof value === 'bigint') return value.toString();
    if (typeof value !== 'object' || value === null) return value;

    // `this` is the parent of `value`. Keep only the ancestors on its path.
    while (ancestors.length > 0 && ancestors.at(-1) !== this) ancestors.pop();
    if (ancestors.includes(value)) return '[Circular]';

    const output = value instanceof Error ? errorFields(value) : value;
    ancestors.push(output);
    return output;
  };
}

function errorFields(err: Error): LogObject {
  const { code } = err as Error & { code?: unknown };
  return {
    name: err.name,
    message: err.message,
    ...(code !== undefined ? { code } : {}),
  };
}

/**
 * Flatten a nested object into a flat key-value object.
 */
export function flattenObject(
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
export function reorderKeys(obj: LogObject): LogObject {
  const { time, level, name, msg, ...rest } = obj;
  return {
    ...(time !== undefined && { time }),
    ...(level !== undefined && { level }),
    ...(name !== undefined && { name }),
    ...(msg !== undefined && { msg }),
    ...rest,
  };
}
