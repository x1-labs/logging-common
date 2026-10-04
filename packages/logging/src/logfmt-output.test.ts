import { describe, expect, spyOn, test } from 'bun:test';
import { once } from 'events';
import { resolveDestination } from './format';
import logfmtTransport from './logfmt-transport';
import { createLogger } from './logger';

type LogObject = Record<string, unknown>;

/** Run `fn` and return the chunks it writes to stdout. */
async function captureStdout(fn: () => unknown): Promise<string[]> {
  const chunks: string[] = [];
  const spy = spyOn(process.stdout, 'write').mockImplementation(
    (chunk: string | Uint8Array) => {
      chunks.push(String(chunk));
      return true;
    },
  );
  try {
    await fn();
  } finally {
    spy.mockRestore();
  }
  return chunks;
}

/**
 * The two ways a record reaches the logfmt writer. Each one gets the JSON line
 * that pino writes, so both must give the same output.
 */
const paths: {
  name: string;
  write(record: LogObject, flatten: boolean): Promise<void>;
}[] = [
  {
    name: 'destination stream',
    async write(record, flatten) {
      const previous = process.env.LOG_FLATTEN_NESTED;
      process.env.LOG_FLATTEN_NESTED = String(flatten);
      try {
        const stream = resolveDestination('logfmt');
        if (!stream) throw new Error('no logfmt destination');
        stream.write(JSON.stringify(record) + '\n');
      } finally {
        if (previous === undefined) delete process.env.LOG_FLATTEN_NESTED;
        else process.env.LOG_FLATTEN_NESTED = previous;
      }
    },
  },
  {
    name: 'transport',
    async write(record, flatten) {
      const transport = await logfmtTransport({
        flattenNestedObjects: flatten,
      });
      transport.write(JSON.stringify(record) + '\n');
      transport.end();
      await once(transport, 'close');
    },
  },
];

interface Case {
  name: string;
  record: LogObject;
  /** LOG_FLATTEN_NESTED. On by default. */
  flatten?: boolean;
  line: string;
}

/** Existing LogQL filters depend on this output. It must not change. */
const unchanged: Case[] = [
  {
    name: 'strings',
    record: { msg: 'hello', note: 'hello world' },
    line: 'msg=hello note="hello world"',
  },
  {
    name: 'numbers',
    record: { count: 42, rate: 3.14, delta: -1 },
    line: 'count=42 rate=3.14 delta=-1',
  },
  {
    name: 'booleans',
    record: { ok: true, retried: false },
    line: 'ok=true retried=false',
  },
  { name: 'null', record: { value: null }, line: 'value=' },
  {
    name: 'arrays of primitives',
    record: { tags: ['a', 'b', 'c'], ids: [1, 2, 3], flags: [true, false] },
    line: 'tags=a,b,c ids=1,2,3 flags=true,false',
  },
  {
    name: 'an array of strings with spaces',
    record: { names: ['a b', 'c'] },
    line: 'names="a b,c"',
  },
  { name: 'an empty array', record: { none: [] }, line: 'none=""' },
  {
    name: 'an array with a null',
    record: { gaps: [null, 1] },
    line: 'gaps=,1',
  },
  {
    name: 'flattened nested objects',
    record: {
      error: { type: 'Error', message: 'oops' },
      a: { b: { c: 'deep' } },
    },
    line: 'error_type=Error error_message=oops a_b_c=deep',
  },
];

/** `String()` wrote these as `[object Object]`. They are now compact JSON. */
const json: Case[] = [
  {
    name: 'an array of objects',
    record: {
      failures: [
        { vote: 'Vote111', error: 'timeout' },
        { vote: 'Vote222', error: 'rate limited' },
      ],
    },
    line: String.raw`failures="[{\"vote\":\"Vote111\",\"error\":\"timeout\"},{\"vote\":\"Vote222\",\"error\":\"rate limited\"}]"`,
  },
  {
    name: 'a nested object with flattening off',
    record: { detail: { epoch: 383, reason: 'outside window' } },
    flatten: false,
    line: String.raw`detail="{\"epoch\":383,\"reason\":\"outside window\"}"`,
  },
  {
    name: 'a mixed array',
    record: { mixed: [1, 'a', { b: 2 }, null] },
    line: String.raw`mixed="[1,\"a\",{\"b\":2},null]"`,
  },
  {
    name: 'nested arrays',
    record: { ranges: [[1, 2], [3]] },
    line: 'ranges=[[1,2],[3]]',
  },
  {
    name: 'an array of objects in a flattened object',
    record: { detail: { failures: [{ slot: 1 }] } },
    line: String.raw`detail_failures="[{\"slot\":1}]"`,
  },
  {
    name: 'JSON with quotes, spaces, = and newlines',
    record: {
      errors: [
        {
          msg: 'say "hi"',
          expr: 'a=b c',
          text: 'line1\nline2',
          path: 'C:\\tmp',
        },
      ],
    },
    line: String.raw`errors="[{\"msg\":\"say \\\"hi\\\"\",\"expr\":\"a=b c\",\"text\":\"line1\\nline2\",\"path\":\"C:\\\\tmp\"}]"`,
  },
];

/** Read the quoted value of `key` back out of a logfmt line. */
function readQuoted(line: string, key: string): string {
  const quoted = new RegExp(`(?:^| )${key}="((?:[^"\\\\]|\\\\.)*)"`).exec(line);
  if (!quoted) throw new Error(`no quoted ${key} in: ${line}`);
  return quoted[1].replace(/\\(.)/g, (_, c: string) =>
    c === 'n' ? '\n' : c === 'r' ? '\r' : c,
  );
}

for (const path of paths) {
  describe(`logfmt ${path.name}`, () => {
    for (const c of [...unchanged, ...json]) {
      test(c.name, async () => {
        const out = await captureStdout(() =>
          path.write(c.record, c.flatten ?? true),
        );

        expect(out).toEqual([c.line + '\n']);
      });
    }

    test('a JSON value reads back to the logged data', async () => {
      const errors = [
        { msg: 'say "hi"', expr: 'a=b c', text: 'line1\nline2', path: 'C:\\' },
      ];
      const [line] = await captureStdout(() => path.write({ errors }, true));

      expect(JSON.parse(readQuoted(line, 'errors'))).toEqual(errors);
    });
  });
}

describe('createLogger logfmt with live values', () => {
  test('gives one line for BigInt, a circular reference and Errors', async () => {
    const circular: LogObject = { id: 1 };
    circular.self = circular;
    const logger = createLogger({
      format: 'logfmt',
      level: 'info',
      timestamp: false,
    });

    const out = await captureStdout(() =>
      logger.info(
        {
          big: 10n,
          bigs: [1n, 2n],
          circular,
          errors: [
            new Error('boom'),
            Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }),
          ],
        },
        'sync failed',
      ),
    );

    // pino serializes the record before the logfmt writer gets it. It writes
    // BigInt as a number and a circular reference as "[Circular]". An Error
    // keeps only its own enumerable fields, so its message is already gone.
    expect(out).toEqual([
      String.raw`level=INFO msg="sync failed" big=10 bigs=1,2 circular_id=1 circular_self=[Circular] errors="[{},{\"code\":\"ECONNREFUSED\"}]"` +
        '\n',
    ]);
  });
});
