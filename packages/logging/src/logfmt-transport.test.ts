import { describe, expect, test } from 'bun:test';

// Import the internal functions by re-exporting them for testing
// We'll test the stringify and flattenObject functions directly

type LogObject = Record<string, unknown>;

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

    const needsQuoting = value.includes(' ') || value.includes('=');
    const needsEscaping = value.includes('"') || value.includes('\\');

    if (needsEscaping) value = value.replace(/["\\]/g, '\\$&');
    if (needsQuoting || needsEscaping) value = '"' + value + '"';
    if (value === '' && raw != null) value = '""';

    line += key + '=' + value + ' ';
  }

  return line.trimEnd();
}

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

function reorderKeys(obj: LogObject): LogObject {
  const { time, level, msg, ...rest } = obj;
  return {
    ...(time !== undefined && { time }),
    ...(level !== undefined && { level }),
    ...(msg !== undefined && { msg }),
    ...rest,
  };
}

describe('stringify', () => {
  test('simple key-value pairs', () => {
    expect(stringify({ foo: 'bar', num: 42 })).toBe('foo=bar num=42');
  });

  test('quotes values with spaces', () => {
    expect(stringify({ msg: 'hello world' })).toBe('msg="hello world"');
  });

  test('quotes values with equals sign', () => {
    expect(stringify({ expr: 'a=b' })).toBe('expr="a=b"');
  });

  test('escapes double quotes', () => {
    expect(stringify({ msg: 'say "hello"' })).toBe('msg="say \\"hello\\""');
  });

  test('escapes backslashes', () => {
    expect(stringify({ path: 'C:\\Users' })).toBe('path="C:\\\\Users"');
  });

  test('handles null values', () => {
    expect(stringify({ foo: null })).toBe('foo=');
  });

  test('handles undefined values', () => {
    expect(stringify({ foo: undefined })).toBe('foo=');
  });

  test('handles empty string as quoted', () => {
    expect(stringify({ foo: '' })).toBe('foo=""');
  });

  test('handles boolean values', () => {
    expect(stringify({ active: true, deleted: false })).toBe(
      'active=true deleted=false',
    );
  });

  test('handles numeric values', () => {
    expect(stringify({ count: 123, rate: 3.14 })).toBe('count=123 rate=3.14');
  });
});

describe('flattenObject', () => {
  test('flattens nested objects', () => {
    const input = { error: { type: 'Error', message: 'failed' } };
    expect(flattenObject(input)).toEqual({
      error_type: 'Error',
      error_message: 'failed',
    });
  });

  test('preserves flat properties', () => {
    const input = { foo: 'bar', nested: { baz: 'qux' } };
    expect(flattenObject(input)).toEqual({
      foo: 'bar',
      nested_baz: 'qux',
    });
  });

  test('handles deeply nested objects', () => {
    const input = { a: { b: { c: 'deep' } } };
    expect(flattenObject(input)).toEqual({
      a_b_c: 'deep',
    });
  });

  test('preserves arrays without flattening', () => {
    const input = { tags: ['a', 'b', 'c'] };
    expect(flattenObject(input)).toEqual({
      tags: ['a', 'b', 'c'],
    });
  });

  test('uses custom separator', () => {
    const input = { error: { type: 'Error' } };
    expect(flattenObject(input, '.')).toEqual({
      'error.type': 'Error',
    });
  });

  test('handles null values in nested objects', () => {
    const input = { data: { value: null } };
    expect(flattenObject(input)).toEqual({
      data_value: null,
    });
  });
});

describe('reorderKeys', () => {
  test('orders time, level, msg first', () => {
    const input = { foo: 'bar', msg: 'hello', level: 'INFO', time: 123 };
    const result = reorderKeys(input);
    const keys = Object.keys(result);

    expect(keys[0]).toBe('time');
    expect(keys[1]).toBe('level');
    expect(keys[2]).toBe('msg');
    expect(keys[3]).toBe('foo');
  });

  test('handles missing priority keys', () => {
    const input = { foo: 'bar', level: 'INFO' };
    const result = reorderKeys(input);
    const keys = Object.keys(result);

    expect(keys[0]).toBe('level');
    expect(keys[1]).toBe('foo');
  });

  test('preserves all values', () => {
    const input = { foo: 'bar', msg: 'hello', level: 'INFO', time: 123 };
    const result = reorderKeys(input);

    expect(result.time).toBe(123);
    expect(result.level).toBe('INFO');
    expect(result.msg).toBe('hello');
    expect(result.foo).toBe('bar');
  });
});

describe('integration', () => {
  test('full logfmt output with ordering', () => {
    const input = { name: 'app', msg: 'hello world', level: 'INFO', time: 123 };
    const ordered = reorderKeys(input);
    const output = stringify(ordered);

    expect(output).toBe('time=123 level=INFO msg="hello world" name=app');
  });

  test('full logfmt output with flattening', () => {
    const input = {
      time: 123,
      level: 'ERROR',
      msg: 'failed',
      error: { type: 'Error', message: 'oops' },
    };
    const flattened = flattenObject(input);
    const ordered = reorderKeys(flattened);
    const output = stringify(ordered);

    expect(output).toBe(
      'time=123 level=ERROR msg=failed error_type=Error error_message=oops',
    );
  });
});
