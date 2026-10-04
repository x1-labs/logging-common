import { describe, expect, test } from 'bun:test';
import {
  flattenObject,
  formatLogfmt,
  reorderKeys,
  stringifyLogfmt,
} from './logfmt';

describe('stringifyLogfmt', () => {
  test('simple key-value pairs', () => {
    expect(stringifyLogfmt({ foo: 'bar', num: 42 })).toBe('foo=bar num=42');
  });

  test('quotes values with spaces', () => {
    expect(stringifyLogfmt({ msg: 'hello world' })).toBe('msg="hello world"');
  });

  test('quotes values with equals sign', () => {
    expect(stringifyLogfmt({ expr: 'a=b' })).toBe('expr="a=b"');
  });

  test('escapes double quotes', () => {
    expect(stringifyLogfmt({ msg: 'say "hello"' })).toBe(
      'msg="say \\"hello\\""',
    );
  });

  test('escapes backslashes', () => {
    expect(stringifyLogfmt({ path: 'C:\\Users' })).toBe('path="C:\\\\Users"');
  });

  test('handles null values', () => {
    expect(stringifyLogfmt({ foo: null })).toBe('foo=');
  });

  test('handles undefined values', () => {
    expect(stringifyLogfmt({ foo: undefined })).toBe('foo=');
  });

  test('handles empty string as quoted', () => {
    expect(stringifyLogfmt({ foo: '' })).toBe('foo=""');
  });

  test('handles boolean values', () => {
    expect(stringifyLogfmt({ active: true, deleted: false })).toBe(
      'active=true deleted=false',
    );
  });

  test('handles numeric values', () => {
    expect(stringifyLogfmt({ count: 123, rate: 3.14 })).toBe(
      'count=123 rate=3.14',
    );
  });

  test('escapes newlines', () => {
    expect(stringifyLogfmt({ msg: 'line1\nline2' })).toBe(
      'msg="line1\\nline2"',
    );
  });

  test('escapes carriage returns', () => {
    expect(stringifyLogfmt({ msg: 'line1\rline2' })).toBe(
      'msg="line1\\rline2"',
    );
  });

  test('escapes CRLF', () => {
    expect(stringifyLogfmt({ msg: 'line1\r\nline2' })).toBe(
      'msg="line1\\nline2"',
    );
  });

  test('escapes stack traces', () => {
    const stack = 'Error: failed\n  at foo()\n  at bar()';
    const result = stringifyLogfmt({ err_stack: stack });
    expect(result).toBe('err_stack="Error: failed\\n  at foo()\\n  at bar()"');
    expect(result).not.toContain('\n');
  });

  test('escapes newlines with quotes and backslashes', () => {
    const value = 'Error: "bad"\n  at C:\\path';
    const result = stringifyLogfmt({ msg: value });
    expect(result).toBe('msg="Error: \\"bad\\"\\n  at C:\\\\path"');
    expect(result).not.toContain('\n');
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

  test('puts name between level and msg', () => {
    const input = { foo: 'bar', msg: 'hello', name: 'app', level: 'INFO' };
    const keys = Object.keys(reorderKeys(input));

    expect(keys).toEqual(['level', 'name', 'msg', 'foo']);
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

describe('formatLogfmt', () => {
  test('full logfmt output with ordering', () => {
    const input = { name: 'app', msg: 'hello world', level: 'INFO', time: 123 };

    expect(formatLogfmt(input)).toBe(
      'time=123 level=INFO name=app msg="hello world"',
    );
  });

  test('full logfmt output with flattening', () => {
    const input = {
      time: 123,
      level: 'ERROR',
      msg: 'failed',
      error: { type: 'Error', message: 'oops' },
    };

    expect(formatLogfmt(input, { flattenNestedObjects: true })).toBe(
      'time=123 level=ERROR msg=failed error_type=Error error_message=oops',
    );
  });

  test('uses the flatten separator', () => {
    const input = { error: { type: 'Error' } };

    expect(
      formatLogfmt(input, {
        flattenNestedObjects: true,
        flattenSeparator: '.',
      }),
    ).toBe('error.type=Error');
  });
});

// The logger always gives the writer a record parsed from pino's JSON line.
// These cases call the writer directly with live values.
describe('stringifyLogfmt with live values', () => {
  test('writes a BigInt field and an array of BigInt as before', () => {
    expect(stringifyLogfmt({ amount: 10n, amounts: [1n, 2n] })).toBe(
      'amount=10 amounts=1,2',
    );
  });

  test('writes a BigInt inside JSON as a string', () => {
    const transfers = [{ amount: 18446744073709551615n }];

    expect(stringifyLogfmt({ transfers })).toBe(
      String.raw`transfers="[{\"amount\":\"18446744073709551615\"}]"`,
    );
  });

  test('writes a reference back to an ancestor as [Circular]', () => {
    const node: Record<string, unknown> = { id: 1 };
    node.self = node;

    expect(stringifyLogfmt({ nodes: [node] })).toBe(
      String.raw`nodes="[{\"id\":1,\"self\":\"[Circular]\"}]"`,
    );
  });

  test('finds a reference back to an ancestor after a sibling object', () => {
    const root: Record<string, unknown> = { x: { k: 1 } };
    root.y = { back: root };

    expect(stringifyLogfmt({ roots: [root] })).toBe(
      String.raw`roots="[{\"x\":{\"k\":1},\"y\":{\"back\":\"[Circular]\"}}]"`,
    );
  });

  test('writes a repeated object in full each time', () => {
    const shared = { id: 1 };

    expect(stringifyLogfmt({ pair: [shared, shared] })).toBe(
      String.raw`pair="[{\"id\":1},{\"id\":1}]"`,
    );
  });

  test('writes an Error as its name, message and code', () => {
    const errors = [
      new TypeError('bad input'),
      Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }),
    ];

    expect(stringifyLogfmt({ errors })).toBe(
      String.raw`errors="[{\"name\":\"TypeError\",\"message\":\"bad input\"},{\"name\":\"Error\",\"message\":\"refused\",\"code\":\"ECONNREFUSED\"}]"`,
    );
  });

  test('writes [Unserializable] if JSON cannot write a value', () => {
    const broken = {
      toJSON() {
        throw new Error('no JSON');
      },
    };

    expect(stringifyLogfmt({ broken: [broken], ok: 1 })).toBe(
      'broken=[Unserializable] ok=1',
    );
  });
});
