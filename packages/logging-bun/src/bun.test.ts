import { describe, expect, test } from 'bun:test';
import type { DestinationStream } from 'pino';
import { createBunLogger } from './bun';
import type { RequestIPProvider } from './bun';

type LogLine = Record<string, unknown>;

/**
 * Pino always serializes to JSON before handing a chunk to its destination
 * stream, so injecting one here gives us the record regardless of LOG_FORMAT.
 */
export function collect(): { lines: LogLine[]; stream: DestinationStream } {
  const lines: LogLine[] = [];
  return {
    lines,
    stream: {
      write(chunk: string): void {
        lines.push(JSON.parse(chunk) as LogLine);
      },
    },
  };
}

describe('createBunLogger access log', () => {
  test('emits a request completed line matching the express field order', async () => {
    const { lines, stream } = collect();
    const { wrapFetch } = createBunLogger({ name: 'api', destination: stream });

    const handler = wrapFetch(
      async () =>
        new Response('{"ok":1}', {
          headers: { 'content-type': 'application/json' },
        }),
    );

    await handler(new Request('http://127.0.0.1/ok?a=1&b=2'), {});

    expect(lines).toHaveLength(1);
    const line = lines[0];

    expect(Object.keys(line)).toEqual([
      'level',
      'time',
      'name',
      'req',
      'res',
      'responseTime',
      'msg',
    ]);
    expect(line.level).toBe('INFO');
    expect(line.name).toBe('api');
    expect(line.msg).toBe('request completed');
    expect(typeof line.responseTime).toBe('number');

    const req = line.req as LogLine;
    expect(Object.keys(req)).toEqual([
      'id',
      'method',
      'url',
      'query',
      'params',
      'headers',
    ]);
    expect(req.id).toBe(1);
    expect(req.method).toBe('GET');
    expect(req.url).toBe('/ok?a=1&b=2');
    expect(req.query).toEqual({ a: '1', b: '2' });
    expect(req.params).toEqual({});

    const res = line.res as LogLine;
    expect(Object.keys(res)).toEqual(['statusCode', 'headers']);
    expect(res.statusCode).toBe(200);
    expect((res.headers as LogLine)['content-type']).toBe('application/json');
  });

  test('increments req.id from 1 across requests', async () => {
    const { lines, stream } = collect();
    const { wrapFetch } = createBunLogger({ destination: stream });
    const handler = wrapFetch(async () => new Response('ok'));

    await handler(new Request('http://127.0.0.1/a'), {});
    await handler(new Request('http://127.0.0.1/b'), {});

    expect((lines[0].req as LogLine).id).toBe(1);
    expect((lines[1].req as LogLine).id).toBe(2);
  });

  test('attaches a child logger carrying the request bindings', async () => {
    const { lines, stream } = collect();
    const { wrapFetch } = createBunLogger({ name: 'api', destination: stream });

    const handler = wrapFetch(async (req) => {
      req.log.info({ txSig: 'abc' }, 'building transaction');
      return new Response('ok');
    });

    await handler(new Request('http://127.0.0.1/ok'), {});

    expect(lines).toHaveLength(2);
    const handlerLine = lines[0];
    expect(handlerLine.msg).toBe('building transaction');
    expect(handlerLine.txSig).toBe('abc');
    // The handler's own logs carry the full req binding, as express does.
    expect((handlerLine.req as LogLine).id).toBe(1);
    expect((handlerLine.req as LogLine).url).toBe('/ok');
  });

  test('exposes req.id on the request object', async () => {
    const { stream } = collect();
    const { wrapFetch } = createBunLogger({ destination: stream });

    let seen: number | undefined;
    const handler = wrapFetch(async (req) => {
      seen = req.id;
      return new Response('ok');
    });

    await handler(new Request('http://127.0.0.1/ok'), {});

    expect(seen).toBe(1);
  });
});

/** Stands in for Bun's Server, which is the only source of the peer address. */
function serverWithIP(address: string, port = 50740): RequestIPProvider {
  return { requestIP: () => ({ address, port, family: 'IPv4' }) };
}

describe('createBunLogger client ip', () => {
  test('prefers the first x-forwarded-for entry', async () => {
    const { lines, stream } = collect();
    const { wrapFetch } = createBunLogger({ destination: stream });
    const handler = wrapFetch(async () => new Response('ok'));

    await handler(
      new Request('http://127.0.0.1/ok', {
        headers: { 'x-forwarded-for': '9.9.9.9, 10.0.0.1' },
      }),
      serverWithIP('::ffff:127.0.0.1'),
    );

    expect(lines[0].ip).toBe('9.9.9.9');
  });

  test('falls back to the peer address when no forwarded header is present', async () => {
    const { lines, stream } = collect();
    const { wrapFetch } = createBunLogger({ destination: stream });
    const handler = wrapFetch(async () => new Response('ok'));

    await handler(
      new Request('http://127.0.0.1/ok'),
      serverWithIP('::ffff:127.0.0.1'),
    );

    expect(lines[0].ip).toBe('::ffff:127.0.0.1');
  });

  test('omits ip entirely when forwardedIp is false', async () => {
    const { lines, stream } = collect();
    const { wrapFetch } = createBunLogger({
      destination: stream,
      forwardedIp: false,
    });
    const handler = wrapFetch(async () => new Response('ok'));

    await handler(
      new Request('http://127.0.0.1/ok', {
        headers: { 'x-forwarded-for': '9.9.9.9' },
      }),
      serverWithIP('::ffff:127.0.0.1'),
    );

    // express drops the customProps hook entirely, so the key is absent —
    // not present-and-null.
    expect(lines[0]).not.toHaveProperty('ip');
  });

  test('records remoteAddress and remotePort in express key order', async () => {
    const { lines, stream } = collect();
    const { wrapFetch } = createBunLogger({ name: 'api', destination: stream });
    const handler = wrapFetch(async () => new Response('ok'));

    await handler(
      new Request('http://127.0.0.1/ok'),
      serverWithIP('::ffff:127.0.0.1', 50740),
    );

    const req = lines[0].req as LogLine;
    expect(Object.keys(req)).toEqual([
      'id',
      'method',
      'url',
      'query',
      'params',
      'headers',
      'remoteAddress',
      'remotePort',
    ]);
    expect(req.remoteAddress).toBe('::ffff:127.0.0.1');
    expect(req.remotePort).toBe(50740);

    expect(Object.keys(lines[0])).toEqual([
      'level',
      'time',
      'name',
      'req',
      'ip',
      'res',
      'responseTime',
      'msg',
    ]);
  });

  test('omits remoteAddress when the server cannot supply one', async () => {
    const { lines, stream } = collect();
    const { wrapFetch } = createBunLogger({ destination: stream });
    const handler = wrapFetch(async () => new Response('ok'));

    await handler(new Request('http://127.0.0.1/ok'), {
      requestIP: () => null,
    });

    const req = lines[0].req as LogLine;
    expect(req).not.toHaveProperty('remoteAddress');
    expect(req).not.toHaveProperty('remotePort');
  });
});

describe('createBunLogger error handling', () => {
  test('logs the real thrown error and rethrows it', async () => {
    const { lines, stream } = collect();
    const { wrapFetch } = createBunLogger({ name: 'api', destination: stream });

    const handler = wrapFetch(async () => {
      throw new Error('kaboom');
    });

    // The throw must propagate so Bun's own error handler decides the response.
    await expect(
      handler(new Request('http://127.0.0.1/boom'), {}),
    ).rejects.toThrow('kaboom');

    expect(lines).toHaveLength(1);
    const line = lines[0];

    expect(line.msg).toBe('request errored');
    // Matches express: the level stays INFO even for a failed request.
    expect(line.level).toBe('INFO');

    // Unlike express, the error is the real one, not a synthesized
    // "failed with status code 500".
    const err = line.err as LogLine;
    expect(err.type).toBe('Error');
    expect(err.message).toBe('kaboom');
    expect(err.stack).toContain('kaboom');
  });

  test('omits res when no response was produced', async () => {
    const { lines, stream } = collect();
    const { wrapFetch } = createBunLogger({ destination: stream });
    const handler = wrapFetch(async () => {
      throw new Error('kaboom');
    });

    await expect(
      handler(new Request('http://127.0.0.1/boom'), {}),
    ).rejects.toThrow();

    expect(lines[0]).not.toHaveProperty('res');
    expect(Object.keys(lines[0])).toEqual([
      'level',
      'time',
      'req',
      'err',
      'responseTime',
      'msg',
    ]);
  });

  test('logs 4xx responses at INFO with request completed', async () => {
    const { lines, stream } = collect();
    const { wrapFetch } = createBunLogger({ destination: stream });
    const handler = wrapFetch(
      async () => new Response('nope', { status: 404 }),
    );

    await handler(new Request('http://127.0.0.1/missing'), {});

    expect(lines[0].level).toBe('INFO');
    expect(lines[0].msg).toBe('request completed');
    expect((lines[0].res as LogLine).statusCode).toBe(404);
    expect(lines[0]).not.toHaveProperty('err');
  });
});

// pino-http branches on `err || res.statusCode >= 500`, so express reports a
// *returned* 5xx exactly like a thrown one: `request errored`, still at INFO,
// with an Error synthesized from the status code. Verified against a live
// express server: 499 -> `request completed`; 500/503/599 -> `request errored`
// with err.message `failed with status code <code>`.
describe('createBunLogger returned 5xx', () => {
  test('logs a returned 500 as request errored with a synthesized error', async () => {
    const { lines, stream } = collect();
    const { wrapFetch } = createBunLogger({ destination: stream });
    const handler = wrapFetch(
      async () => new Response('boom', { status: 500 }),
    );

    await handler(new Request('http://127.0.0.1/broken'), {});

    expect(lines[0].level).toBe('INFO');
    expect(lines[0].msg).toBe('request errored');

    const err = lines[0].err as LogLine;
    expect(err.type).toBe('Error');
    expect(err.message).toBe('failed with status code 500');
  });

  test('synthesizes the error from the actual status code', async () => {
    const { lines, stream } = collect();
    const { wrapFetch } = createBunLogger({ destination: stream });
    const handler = wrapFetch(
      async (req) =>
        new Response('x', {
          status: Number(new URL(req.url).pathname.slice(1)),
        }),
    );

    await handler(new Request('http://127.0.0.1/503'), {});
    await handler(new Request('http://127.0.0.1/599'), {});

    expect((lines[0].err as LogLine).message).toBe(
      'failed with status code 503',
    );
    expect((lines[1].err as LogLine).message).toBe(
      'failed with status code 599',
    );
  });

  test('treats 499 as completed, not errored', async () => {
    const { lines, stream } = collect();
    const { wrapFetch } = createBunLogger({ destination: stream });
    const handler = wrapFetch(async () => new Response('x', { status: 499 }));

    await handler(new Request('http://127.0.0.1/499'), {});

    expect(lines[0].msg).toBe('request completed');
    expect(lines[0]).not.toHaveProperty('err');
  });

  test('keeps res on a returned 5xx, in express key order', async () => {
    const { lines, stream } = collect();
    const { wrapFetch } = createBunLogger({ name: 'api', destination: stream });
    const handler = wrapFetch(async () => new Response('x', { status: 500 }));

    await handler(new Request('http://127.0.0.1/broken'), {});

    // Unlike the thrown path, a Response exists here, so `res` is real and is
    // reported -- matching express, which also carries res on a returned 5xx.
    expect((lines[0].res as LogLine).statusCode).toBe(500);
    expect(Object.keys(lines[0])).toEqual([
      'level',
      'time',
      'name',
      'req',
      'res',
      'err',
      'responseTime',
      'msg',
    ]);
  });

  test('leaves the thrown path carrying the real error and no res', async () => {
    const { lines, stream } = collect();
    const { wrapFetch } = createBunLogger({ destination: stream });
    const handler = wrapFetch(async () => {
      throw new Error('database connection lost');
    });

    await expect(
      handler(new Request('http://127.0.0.1/boom'), {}),
    ).rejects.toThrow('database connection lost');

    expect(lines[0].msg).toBe('request errored');
    expect((lines[0].err as LogLine).message).toBe('database connection lost');
    expect(lines[0]).not.toHaveProperty('res');
  });
});

describe('createBunLogger autoLogging', () => {
  test('emits no access line but still provides req.log and req.id', async () => {
    const { lines, stream } = collect();
    const { wrapFetch } = createBunLogger({
      destination: stream,
      autoLogging: false,
    });

    const handler = wrapFetch(async (req) => {
      req.log.info('handler ran');
      expect(req.id).toBe(1);
      return new Response('ok');
    });

    await handler(new Request('http://127.0.0.1/ok'), {});

    // Only the handler's own line; no "request completed".
    expect(lines).toHaveLength(1);
    expect(lines[0].msg).toBe('handler ran');
  });

  test('emits no line when a handler throws', async () => {
    const { lines, stream } = collect();
    const { wrapFetch } = createBunLogger({
      destination: stream,
      autoLogging: false,
    });
    const handler = wrapFetch(async () => {
      throw new Error('kaboom');
    });

    await expect(
      handler(new Request('http://127.0.0.1/boom'), {}),
    ).rejects.toThrow('kaboom');

    expect(lines).toHaveLength(0);
  });
});
