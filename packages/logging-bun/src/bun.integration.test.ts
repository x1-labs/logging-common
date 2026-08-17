import { describe, expect, test } from 'bun:test';
import type { DestinationStream } from 'pino';
import { createBunLogger } from './bun';

type LogLine = Record<string, unknown>;

describe('createBunLogger against a real Bun.serve', () => {
  test('records the peer address from server.requestIP', async () => {
    const lines: LogLine[] = [];
    const stream: DestinationStream = {
      write(chunk: string): void {
        lines.push(JSON.parse(chunk) as LogLine);
      },
    };

    const { wrapFetch } = createBunLogger({ name: 'api', destination: stream });

    // Port 0 lets the OS pick a free port, so the test never collides.
    const server = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch: wrapFetch(async (req) => {
        req.log.info('handling');
        return new Response('ok');
      }),
    });

    try {
      const res = await fetch(`http://127.0.0.1:${server.port}/ok?a=1`);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('ok');
    } finally {
      server.stop(true);
    }

    const access = lines.find((l) => l.msg === 'request completed');
    expect(access).toBeDefined();

    const req = access!.req as LogLine;
    expect(req.url).toBe('/ok?a=1');
    expect(req.id).toBe(1);
    // The whole point of this test: these come from a real Bun.Server.
    expect(req.remoteAddress).toBe('127.0.0.1');
    expect(typeof req.remotePort).toBe('number');
    expect(access!.ip).toBe('127.0.0.1');

    expect((access!.res as LogLine).statusCode).toBe(200);

    const handlerLine = lines.find((l) => l.msg === 'handling');
    expect(handlerLine).toBeDefined();
    expect((handlerLine!.req as LogLine).id).toBe(1);
  });
});
