# `@x1-labs/logging-bun` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a fourth workspace package, `@x1-labs/logging-bun`, that gives `Bun.serve` services access logs field-for-field identical to what `@x1-labs/logging-express` emits.

**Architecture:** A `createBunLogger()` factory returns `{ logger, wrapFetch }`. `wrapFetch` wraps a Bun fetch handler — the analogue of `app.use(middleware)` — timing the handler, attaching a per-request child logger to the `Request` object as `req.log`, and emitting one access-log line per request. All level/format/base/timestamp/error-serializer resolution is delegated to `@x1-labs/logging`, exactly as the Express package does.

**Tech Stack:** TypeScript (CommonJS, ES2022), Pino 10, Bun workspaces, `bun test`.

**Spec:** `docs/superpowers/specs/2026-08-16-bun-serve-logging-design.md`

## Global Constraints

- Package name `@x1-labs/logging-bun`, version `0.1.28` (matches all other packages today).
- Dependencies: `@x1-labs/logging` at `^0.1.28`, `pino` at `^10.0.0`. Optional peer `pino-pretty` at `^13.0.0`.
- **No `bun` or `@types/bun` dependency in the package.** Source must reference no `Bun` global — only standard `Request`/`Response` and the structural `RequestIPProvider` type. `@types/bun` is already a root devDependency and is what makes the integration test compile.
- Access-log records must match the Express baseline exactly: key set, key order, `msg` strings, and `INFO` level for every status.
- Top-level key order: `level, time, name, req, ip, res, [err], responseTime, msg`.
- `req` key order: `id, method, url, query, params, headers, remoteAddress, remotePort`.
- `res` key order: `statusCode, headers`.
- `req.id` is an integer counter starting at 1, per `createBunLogger` instance.
- Every request logs at `info` regardless of status. No `customLogLevel` option.
- Existing code style: single quotes, semicolons, 2-space indent, trailing commas (Prettier defaults already configured at the root).

---

## Baseline reference

Both facts below were captured from a live Express server and are what the tests assert against.

Access-log line:

```json
{"level":"INFO","time":"2026-08-16T18:52:35.362Z","name":"api",
 "req":{"id":1,"method":"GET","url":"/ok?a=1&b=2","query":{"a":"1","b":"2"},"params":{},
        "headers":{"host":"..."},"remoteAddress":"::ffff:127.0.0.1","remotePort":50740},
 "ip":"9.9.9.9",
 "res":{"statusCode":200,"headers":{"content-type":"application/json; charset=utf-8"}},
 "responseTime":2,"msg":"request completed"}
```

A log written from inside the handler via `req.log.info({ txSig }, 'building transaction')`:

```json
{"level":"INFO","time":"...","name":"api",
 "req":{"id":1,"method":"GET","url":"/ok", ...},
 "ip":"::ffff:127.0.0.1","txSig":"abc","msg":"building transaction"}
```

So `req.log` is `logger.child({ req, ip })` — the full serialized request plus `ip` — created **before** the handler runs. The access line is then emitted through that same child with only `res` and `responseTime` as merge keys. This is what produces the required key order for free.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `packages/logging-bun/package.json` | Package manifest, mirrors `logging-express` |
| `packages/logging-bun/tsconfig.json` | Extends root, `outDir ./dist`, `rootDir ./src` |
| `packages/logging-bun/tsconfig.build.json` | Extends the above, excludes `**/*.spec.ts` |
| `packages/logging-bun/src/bun.ts` | `createBunLogger`, all types, all record construction |
| `packages/logging-bun/src/index.ts` | Public re-exports |
| `packages/logging-bun/src/bun.test.ts` | Unit tests with an injected destination |
| `packages/logging-bun/src/bun.integration.test.ts` | One real `Bun.serve` test for `server.requestIP` |
| `scripts/bump-version.sh` | Modify: glob nested packages instead of hardcoding two |
| `README.md` | Modify: package table, install line, usage example |
| `CLAUDE.md` | Modify: overview, architecture, design-decisions sections |

`bun.ts` stays a single file. It is one cohesive unit — the record shape *is* the package — and comes to roughly 150 lines, comparable to `logging-express/src/express.ts`.

---

### Task 1: Package scaffold and the success-path access log

**Files:**
- Create: `packages/logging-bun/package.json`
- Create: `packages/logging-bun/tsconfig.json`
- Create: `packages/logging-bun/tsconfig.build.json`
- Create: `packages/logging-bun/src/bun.ts`
- Create: `packages/logging-bun/src/index.ts`
- Test: `packages/logging-bun/src/bun.test.ts`

**Interfaces:**
- Consumes: `resolveLogLevel`, `resolveLogFormat`, `resolveDestination`, `resolveTimestamp`, `resolveBase`, `serializeError`, and the type `CreateLoggerOptions`, all from `@x1-labs/logging`.
- Produces: `createBunLogger(options?: CreateBunLoggerOptions): BunLogger`, the types `CreateBunLoggerOptions`, `BunLogger`, `LoggedRequest`, `RequestIPProvider`, and the test helper `collect()` used by Tasks 2–4.

- [ ] **Step 1: Create `packages/logging-bun/package.json`**

```json
{
  "name": "@x1-labs/logging-bun",
  "version": "0.1.28",
  "description": "Bun.serve access logging middleware",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "default": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/x1-labs/ts-logging-common.git",
    "directory": "packages/logging-bun"
  },
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "prepublishOnly": "bun run build",
    "typecheck": "tsc --noEmit",
    "lint": "eslint \"src/**/*.ts\" --fix",
    "format": "prettier --write \"src/**/*.ts\"",
    "check": "bun run lint && bun run typecheck && bun run format --check"
  },
  "dependencies": {
    "@x1-labs/logging": "^0.1.28",
    "pino": "^10.0.0"
  },
  "peerDependencies": {
    "pino-pretty": "^13.0.0"
  },
  "peerDependenciesMeta": {
    "pino-pretty": {
      "optional": true
    }
  },
  "files": [
    "dist"
  ],
  "license": "MIT"
}
```

- [ ] **Step 2: Create the two tsconfig files**

`packages/logging-bun/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
```

`packages/logging-bun/tsconfig.build.json`:

```json
{
  "extends": "./tsconfig.json",
  "exclude": ["**/*.spec.ts"]
}
```

- [ ] **Step 3: Link the workspace**

Run: `bun install`

Expected: `@x1-labs/logging-bun` is linked into `node_modules`, and `packages/logging-bun/node_modules/@x1-labs/logging` resolves to the workspace package.

- [ ] **Step 4: Write the failing test**

Create `packages/logging-bun/src/bun.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test';
import type { DestinationStream } from 'pino';
import { createBunLogger } from './bun';

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
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `bun test packages/logging-bun/src`

Expected: FAIL — `Cannot find module './bun'`.

- [ ] **Step 6: Create `packages/logging-bun/src/bun.ts`**

```typescript
import pino from 'pino';
import type { DestinationStream, Logger, LoggerOptions } from 'pino';
import {
  resolveLogLevel,
  resolveBase,
  resolveLogFormat,
  resolveDestination,
  resolveTimestamp,
  serializeError,
} from '@x1-labs/logging';
import type { CreateLoggerOptions } from '@x1-labs/logging';

export interface CreateBunLoggerOptions extends CreateLoggerOptions {
  /** Emit the access log line for each request (default: true) */
  autoLogging?: boolean;
  /** Derive `ip` from the x-forwarded-for header (default: true) */
  forwardedIp?: boolean;
  /** Override the output stream. Defaults to the resolved format's stream. */
  destination?: DestinationStream;
}

/**
 * Structural subset of Bun's `Server`. Typing the parameter this way keeps the
 * package free of a build-time dependency on Bun's types while still accepting
 * a real `Bun.Server`.
 */
export interface RequestIPProvider {
  requestIP?(req: Request): {
    address: string;
    port: number;
    family: string;
  } | null;
}

/** The request as seen inside a wrapped handler. Mirrors pino-http's req.log. */
export type LoggedRequest = Request & { log: Logger; id: number };

export interface BunLogger {
  logger: Logger;
  wrapFetch<S extends RequestIPProvider>(
    handler: (req: LoggedRequest, server: S) => Response | Promise<Response>,
  ): (req: Request, server: S) => Promise<Response>;
}

type LogObject = Record<string, unknown>;

export function createBunLogger(
  options: CreateBunLoggerOptions = {},
): BunLogger {
  const level = resolveLogLevel(options.level);
  const format = resolveLogFormat(options.format ?? options.json);
  const destination =
    options.destination ?? resolveDestination(format, options.timestamp);
  const autoLogging = options.autoLogging ?? true;
  const base = resolveBase();

  const opts: LoggerOptions = {
    level,
    ...(base !== undefined ? { base } : {}),
    timestamp: resolveTimestamp(options.timestamp),
    formatters: {
      level: (label: string) => ({ level: label.toUpperCase() }),
    },
    ...(options.name ? { name: options.name } : {}),
    ...options.pinoOptions,
    serializers: {
      err: serializeError,
      ...options.pinoOptions?.serializers,
    },
  };

  const logger = destination ? pino(opts, destination) : pino(opts);

  let nextId = 1;

  function serializeRequest(req: Request, id: number): LogObject {
    const url = new URL(req.url);

    // Key order here is the emitted key order, and must match pino-http's
    // default request serializer.
    return {
      id,
      method: req.method,
      url: url.pathname + url.search,
      query: Object.fromEntries(url.searchParams),
      params: {},
      headers: Object.fromEntries(req.headers),
    };
  }

  function serializeResponse(res: Response): LogObject {
    return {
      statusCode: res.status,
      headers: Object.fromEntries(res.headers),
    };
  }

  function wrapFetch<S extends RequestIPProvider>(
    handler: (req: LoggedRequest, server: S) => Response | Promise<Response>,
  ): (req: Request, server: S) => Promise<Response> {
    return async (req: Request, server: S): Promise<Response> => {
      const start = performance.now();
      const id = nextId++;

      const child = logger.child({ req: serializeRequest(req, id) });

      const logged = req as LoggedRequest;
      logged.id = id;
      logged.log = child;

      const res = await handler(logged, server);

      if (autoLogging) {
        child.info(
          {
            res: serializeResponse(res),
            responseTime: Math.round(performance.now() - start),
          },
          'request completed',
        );
      }

      return res;
    };
  }

  return { logger, wrapFetch };
}
```

- [ ] **Step 7: Create `packages/logging-bun/src/index.ts`**

```typescript
export { createBunLogger } from './bun';
export type {
  CreateBunLoggerOptions,
  BunLogger,
  LoggedRequest,
  RequestIPProvider,
} from './bun';
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `bun test packages/logging-bun/src`

Expected: PASS, 4 tests.

- [ ] **Step 9: Verify the package builds and typechecks**

Run: `bun run --filter '@x1-labs/logging-bun' build && bun run --filter '@x1-labs/logging-bun' typecheck`

Expected: both succeed, `packages/logging-bun/dist/index.js` and `index.d.ts` exist.

- [ ] **Step 10: Commit**

```bash
git add packages/logging-bun bun.lock
git commit -m "feat(logging-bun): add package with success-path access logging"
```

---

### Task 2: Client IP, remote address and remote port

**Files:**
- Modify: `packages/logging-bun/src/bun.ts` — `serializeRequest`, `wrapFetch`
- Test: `packages/logging-bun/src/bun.test.ts` — append a new `describe` block

**Interfaces:**
- Consumes: `createBunLogger`, `RequestIPProvider`, and `collect()` from Task 1.
- Produces: no new exports. `serializeRequest` gains a third parameter `server: RequestIPProvider | undefined`; `req` records gain optional `remoteAddress` / `remotePort`; records gain an optional top-level `ip`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/logging-bun/src/bun.test.ts`:

```typescript
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
```

Add `RequestIPProvider` to the import at the top of the test file:

```typescript
import { createBunLogger } from './bun';
import type { RequestIPProvider } from './bun';
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test packages/logging-bun/src`

Expected: FAIL — the new `ip` / `remoteAddress` assertions fail; the four Task 1 tests still pass.

- [ ] **Step 3: Add IP resolution to `bun.ts`**

Add the `forwardedIp` option read alongside the existing `autoLogging` line:

```typescript
  const autoLogging = options.autoLogging ?? true;
  const forwardedIp = options.forwardedIp ?? true;
```

Replace `serializeRequest` with a version that takes the peer address:

```typescript
  function serializeRequest(
    req: Request,
    id: number,
    peer: { address: string; port: number } | null,
  ): LogObject {
    const url = new URL(req.url);

    // Key order here is the emitted key order, and must match pino-http's
    // default request serializer.
    return {
      id,
      method: req.method,
      url: url.pathname + url.search,
      query: Object.fromEntries(url.searchParams),
      params: {},
      headers: Object.fromEntries(req.headers),
      ...(peer !== null
        ? { remoteAddress: peer.address, remotePort: peer.port }
        : {}),
    };
  }
```

Add the `ip` resolver next to it:

```typescript
  /**
   * Mirrors the express package's customProps hook: the first x-forwarded-for
   * entry, falling back to the peer address.
   */
  function resolveIp(
    req: Request,
    peer: { address: string } | null,
  ): string | undefined {
    const forwarded = req.headers.get('x-forwarded-for');
    return forwarded?.split(',')[0]?.trim() || peer?.address;
  }
```

Then update the body of the returned function in `wrapFetch`, replacing the
`const child = ...` line:

```typescript
      const peer = server?.requestIP?.(req) ?? null;
      const ip = forwardedIp ? resolveIp(req, peer) : undefined;

      const child = logger.child({
        req: serializeRequest(req, id, peer),
        ...(ip !== undefined ? { ip } : {}),
      });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test packages/logging-bun/src`

Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/logging-bun/src
git commit -m "feat(logging-bun): resolve client ip, remote address and port"
```

---

### Task 3: Thrown-error handling

**Files:**
- Modify: `packages/logging-bun/src/bun.ts` — `wrapFetch`
- Test: `packages/logging-bun/src/bun.test.ts` — append a new `describe` block

**Interfaces:**
- Consumes: everything from Tasks 1–2.
- Produces: no new exports. Records for a throwing handler gain `err` and omit `res`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/logging-bun/src/bun.test.ts`:

```typescript
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

  test('logs 4xx and 5xx responses at INFO with request completed', async () => {
    const { lines, stream } = collect();
    const { wrapFetch } = createBunLogger({ destination: stream });
    const handler = wrapFetch(
      async (req) =>
        new Response('nope', {
          status: new URL(req.url).pathname === '/missing' ? 404 : 500,
        }),
    );

    await handler(new Request('http://127.0.0.1/missing'), {});
    await handler(new Request('http://127.0.0.1/broken'), {});

    expect(lines[0].level).toBe('INFO');
    expect(lines[0].msg).toBe('request completed');
    expect((lines[0].res as LogLine).statusCode).toBe(404);

    expect(lines[1].level).toBe('INFO');
    expect(lines[1].msg).toBe('request completed');
    expect((lines[1].res as LogLine).statusCode).toBe(500);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test packages/logging-bun/src`

Expected: FAIL — no line is emitted for the throwing handler, so `lines` is empty. The `4xx/5xx` test passes already.

- [ ] **Step 3: Wrap the handler call in a try/catch**

In `bun.ts`, replace the `const res = await handler(...)` block and everything after it, inside the returned function:

```typescript
      let res: Response;
      try {
        res = await handler(logged, server);
      } catch (err) {
        if (autoLogging) {
          // `res` is omitted deliberately: no Response exists, and Bun's error
          // handler may return any status, so a fabricated 500 would lie.
          child.info(
            { err, responseTime: Math.round(performance.now() - start) },
            'request errored',
          );
        }
        throw err;
      }

      if (autoLogging) {
        child.info(
          {
            res: serializeResponse(res),
            responseTime: Math.round(performance.now() - start),
          },
          'request completed',
        );
      }

      return res;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test packages/logging-bun/src`

Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/logging-bun/src
git commit -m "feat(logging-bun): log thrown errors and rethrow"
```

---

### Task 4: `autoLogging: false`

**Files:**
- Test: `packages/logging-bun/src/bun.test.ts` — append a new `describe` block

**Interfaces:**
- Consumes: everything from Tasks 1–3.
- Produces: nothing new. This task confirms behaviour already implemented in Tasks 1 and 3 and locks it against regression.

- [ ] **Step 1: Write the test**

Append to `packages/logging-bun/src/bun.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run the tests**

Run: `bun test packages/logging-bun/src`

Expected: PASS, 14 tests. Both tests should pass without source changes — Tasks 1 and 3 already guard both emit sites with `autoLogging`. If either fails, fix `bun.ts` rather than the test.

- [ ] **Step 3: Commit**

```bash
git add packages/logging-bun/src
git commit -m "test(logging-bun): cover autoLogging false"
```

---

### Task 5: Integration test against a real `Bun.serve`

**Files:**
- Create: `packages/logging-bun/src/bun.integration.test.ts`

**Interfaces:**
- Consumes: `createBunLogger` from Task 1.
- Produces: nothing. This is the only test that exercises a real `Bun.Server`, and so the only honest check that `RequestIPProvider` structurally accepts it and that `server.requestIP` returns what the code expects.

- [ ] **Step 1: Write the test**

```typescript
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
    expect(typeof req.remoteAddress).toBe('string');
    expect(typeof req.remotePort).toBe('number');
    expect(typeof access!.ip).toBe('string');

    expect((access!.res as LogLine).statusCode).toBe(200);

    const handlerLine = lines.find((l) => l.msg === 'handling');
    expect(handlerLine).toBeDefined();
    expect((handlerLine!.req as LogLine).id).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `bun test packages/logging-bun/src/bun.integration.test.ts`

Expected: PASS. If `wrapFetch` does not typecheck against `Bun.serve`'s `fetch` option, the fix belongs in `RequestIPProvider` in `bun.ts` — widen it to match `Bun.Server`, do not cast at the call site.

- [ ] **Step 3: Verify the whole suite and the build**

Run: `bun test packages/*/src && bun run build && bun run typecheck`

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add packages/logging-bun/src
git commit -m "test(logging-bun): integration test against a real Bun.serve"
```

---

### Task 6: Repo wiring — bump script, README, CLAUDE.md

**Files:**
- Modify: `scripts/bump-version.sh:17-21`
- Modify: `README.md:11`, `README.md:23`, `README.md:45`
- Modify: `CLAUDE.md` — Project Overview, Architecture, Key Design Decisions

**Interfaces:**
- Consumes: the published package name `@x1-labs/logging-bun` and the `createBunLogger` API from Task 1.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Fix the version bump script**

`scripts/bump-version.sh` currently hardcodes the nested packages, so a new
package would silently keep a stale `@x1-labs/logging` dependency on every bump.
Replace this loop:

```bash
for f in packages/logging-nestjs/package.json packages/logging-express/package.json; do
```

with a glob over every package except the core one:

```bash
for f in packages/logging-*/package.json; do
```

The core package is `packages/logging/package.json`, which the glob
`packages/logging-*` does not match, so it is correctly skipped.

- [ ] **Step 2: Verify the bump script still works**

Run: `./scripts/bump-version.sh 0.1.28 && git diff --stat`

Expected: all four `package.json` files are rewritten to the same version they
already had, so `git diff` reports **no changes**. This confirms the glob
matched `logging-bun`, `logging-express` and `logging-nestjs` without altering
anything.

- [ ] **Step 3: Update `README.md`**

Add a row to the package table after the `logging-express` row at line 11:

```markdown
| [`@x1-labs/logging-bun`](packages/logging-bun/)         | Bun.serve access logging middleware      | `pino-pretty` (optional)                                  |
```

Add an install line beside the existing ones near line 23:

```bash
npm install @x1-labs/logging-bun
```

Add a usage example after the Express example near line 45:

````markdown
### Bun.serve

```ts
import { createBunLogger } from '@x1-labs/logging-bun';

const { logger, wrapFetch } = createBunLogger({ name: 'api' });

Bun.serve({
  port: 3000,
  fetch: wrapFetch(async (req) => {
    req.log.info({ userId: 42 }, 'handling request');
    return new Response('ok');
  }),
});

logger.info({ port: 3000 }, 'API server listening');
```

Produces the same access log records as `@x1-labs/logging-express`.
````

- [ ] **Step 4: Update `CLAUDE.md`**

In **Project Overview**, change "three packages" to "four packages" and add:

```markdown
- **`@x1-labs/logging-bun`** (`packages/logging-bun/`) — `Bun.serve` access logging middleware. Depends on `@x1-labs/logging`, has `pino-pretty` as an optional peer dependency.
```

In **Architecture**, add a section after the Express one:

```markdown
### `packages/logging-bun/` — Bun.serve Integration

- **`bun.ts`** — `createBunLogger()`: returns `{ logger, wrapFetch }`. `wrapFetch` wraps a `Bun.serve` fetch handler, attaches a per-request child logger as `req.log`, and emits access log records identical to the Express package's. Errors are logged and rethrown so Bun's own `error` handler decides the response.
- Imports `resolveLogLevel`, `resolveBase`, `resolveLogFormat`, `resolveDestination`, `resolveTimestamp`, `serializeError` and `CreateLoggerOptions` from `@x1-labs/logging`.
```

In **Key Design Decisions**, change the "Three-package split" bullet to:

```markdown
- **Four-package split**: projects without a framework depend only on `@x1-labs/logging`; NestJS projects add `@x1-labs/logging-nestjs`; Express projects add `@x1-labs/logging-express`; Bun.serve projects add `@x1-labs/logging-bun`.
```

- [ ] **Step 5: Commit**

```bash
git add scripts/bump-version.sh README.md CLAUDE.md
git commit -m "docs: document @x1-labs/logging-bun and generalise the bump script"
```

---

### Task 7: Full verification and pull request

**Files:** none modified beyond what earlier tasks produced.

**Interfaces:**
- Consumes: the complete working tree from Tasks 1–6.
- Produces: a pull request against `main`.

- [ ] **Step 1: Run the full check suite**

Run: `bun run check`

Expected: format, lint and typecheck all pass across all four packages. Prettier
and ESLint auto-fix, so if this produces changes, review and stage them.

- [ ] **Step 2: Run the full test suite**

Run: `bun test packages/*/src`

Expected: PASS. All Task 1–5 tests plus the pre-existing `logging` package tests.

- [ ] **Step 3: Verify a clean build from scratch**

Run: `rm -rf packages/*/dist && bun run build && ls packages/logging-bun/dist`

Expected: `index.js`, `index.d.ts`, `bun.js`, `bun.d.ts` present. Test files must
**not** appear in `dist` — if `bun.test.js` is emitted, `tsconfig.build.json`
excludes only `**/*.spec.ts`, so add `**/*.test.ts` to its `exclude` array and
rebuild. Check the other packages' builds for the same issue before changing
anything, and match whatever they do.

- [ ] **Step 4: Commit any fixes from steps 1–3**

```bash
git add -A
git commit -m "chore(logging-bun): formatting and build fixes"
```

Skip this step if the working tree is clean.

- [ ] **Step 5: Push and open the pull request**

```bash
git push -u origin feat/bun-serve-logging
gh pr create --base main --title "feat: add @x1-labs/logging-bun for Bun.serve access logging" --body "$(cat <<'EOF'
## Summary

Adds `@x1-labs/logging-bun`, a fourth workspace package giving `Bun.serve`
services access logs field-for-field identical to `@x1-labs/logging-express`.

`pino-http` can't be reused — it's built on Node's `IncomingMessage`/`ServerResponse`
and hooks `res.on('finish')`, while `Bun.serve` is `fetch(req, server) => Response`
over standard Web types with no middleware chain.

## Usage

```ts
const { logger, wrapFetch } = createBunLogger({ name: 'api' });

Bun.serve({
  port: 3000,
  fetch: wrapFetch(async (req) => {
    req.log.info({ userId: 42 }, 'handling request');
    return new Response('ok');
  }),
});
```

`wrapFetch` is the analogue of `app.use(createExpressLogger())`, and `req.log`
carries the same child bindings Express's does.

## Parity

Record shape was captured from a live Express server rather than assumed, which
caught three things worth knowing: `req.id` is an integer counter (not a UUID),
every request logs at `INFO` regardless of status, and a thrown error logs
`request errored` still at `INFO`. All three are matched.

Two deliberate divergences, both forced by Bun having no error middleware:

- **`err` holds the real thrown error.** Express's logger runs after the error
  middleware has already converted the throw to a 500, so it synthesizes
  `Error: failed with status code 500` with a stack pointing into `pino-http`.
  This wrapper still has the real error, so it logs that and rethrows.
- **`res` is omitted on a throw.** No `Response` exists, and Bun's `error`
  handler may return any status, so a fabricated 500 would be a lie. Query
  failed requests with `msg="request errored"`.

## Also

`scripts/bump-version.sh` hardcoded the two nested packages, so a new package
would silently keep a stale `@x1-labs/logging` dependency across version bumps.
Now globs `packages/logging-*/package.json`.

## Testing

14 unit tests asserting exact key sets and key order against the captured
Express baseline, plus one integration test against a real `Bun.serve` covering
`server.requestIP` — the one field a unit test can't fake honestly.

Design doc: `docs/superpowers/specs/2026-08-16-bun-serve-logging-design.md`
EOF
)"
```

- [ ] **Step 6: Report the PR URL**

Print the URL `gh pr create` returned.

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
| --- | --- |
| §Package layout, manifest, tsconfigs | Task 1 steps 1–2 |
| §API — `createBunLogger`, `wrapFetch`, `req.log`, `req.id` | Task 1 |
| §Types — all four exported types | Task 1 steps 6–7 |
| §Field derivation — id/method/url/query/params/headers | Task 1 |
| §Field derivation — remoteAddress/remotePort/ip | Task 2 |
| §Behaviour — success line, key order | Task 1 |
| §Behaviour — throw, real error, rethrow, `res` omitted | Task 3 |
| §Behaviour — all levels INFO | Task 3 step 1 |
| §Behaviour — `autoLogging: false` | Task 4 |
| §Configuration — delegated resolvers | Task 1 step 6 |
| §Testing — unit tests with injected destination | Tasks 1–4 |
| §Testing — integration test for `requestIP` | Task 5 |
| §Repo changes — bump script, README, CLAUDE.md | Task 6 |
| §Delivery — branch and PR | Task 7 |

No gaps.

**Placeholder scan:** No TBDs, no "add error handling", no "similar to Task N".
Every code step carries the literal code.

**Type consistency:** `createBunLogger`, `CreateBunLoggerOptions`, `BunLogger`,
`LoggedRequest`, `RequestIPProvider`, `collect()`, `serverWithIP()`,
`serializeRequest`, `serializeResponse`, `resolveIp` are each spelled
identically everywhere they appear. `serializeRequest` gains its third parameter
in Task 2 and every call site is updated in the same step.

**Streaming caveat** (spec §Behaviour, streaming responses) is documented
behaviour with no code of its own, so it has no task — it falls out of logging
when the handler returns.
