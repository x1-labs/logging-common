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
