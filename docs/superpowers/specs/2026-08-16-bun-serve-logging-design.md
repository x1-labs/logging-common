# `@x1-labs/logging-bun` — Bun.serve access logging

Date: 2026-08-16
Status: approved

## Problem

`@x1-labs/logging-express` gives Express services structured access logs via
`pino-http`. Bun services get nothing. `apps/api-server/server.ts` in
warp-bridge calls `Bun.serve({ port, hostname, idleTimeout, fetch })` and has
only `createLogger({ name: 'server' })` for ad-hoc messages — there is no
per-request access log at all.

`pino-http` cannot be reused. It is built on Node's `IncomingMessage` /
`ServerResponse` and hooks `res.on('finish')`. Bun.serve's contract is
`fetch(req, server) => Response` over standard `Request`/`Response`, with no
middleware chain and no finish event.

## Goal

A fourth package, `@x1-labs/logging-bun`, that produces access logs
**field-for-field identical to what `@x1-labs/logging-express` emits today**, so
a single Loki/Grafana query works across Express and Bun services.

Non-goals: Bun's declarative `routes` object, WebSocket logging, and adopting
the package inside warp-bridge. Each is a separate piece of work.

## Baseline: what Express emits

Captured from a live Express server running `createExpressLogger({ name: 'api' })`
with `LOG_FORMAT=json`:

```json
{"level":"INFO","time":"2026-08-16T18:52:35.362Z","name":"api",
 "req":{"id":1,"method":"GET","url":"/ok?a=1&b=2","query":{"a":"1","b":"2"},
        "params":{},"headers":{"x-forwarded-for":"9.9.9.9, 10.0.0.1","host":"..."},
        "remoteAddress":"::ffff:127.0.0.1","remotePort":50740},
 "ip":"9.9.9.9",
 "res":{"statusCode":200,"headers":{"content-type":"application/json; charset=utf-8"}},
 "responseTime":2,"msg":"request completed"}
```

Three behaviours that had to be measured rather than assumed:

1. `req.id` is an **integer counter** starting at 1, not a UUID.
2. **Every request logs at `INFO`.** A 404 and a 500 both came out `"level":"INFO"`.
   `pino-http` sets no default `customLogLevel`.
3. A request that throws logs `"msg":"request errored"` and still at `INFO`.

Field order is `level, time, name, req, ip, res, [err], responseTime, msg`.
Within `req`: `id, method, url, query, params, headers, remoteAddress, remotePort`.
Within `res`: `statusCode, headers`.

## API

```ts
import { createBunLogger } from '@x1-labs/logging-bun';

const { logger, wrapFetch } = createBunLogger({ name: 'api' });

Bun.serve({
  port: 3000,
  hostname: '127.0.0.1',
  idleTimeout: 255,
  fetch: wrapFetch(async (req, server) => {
    req.log.info({ txSig }, 'building transaction');
    return new Response('ok');
  }),
});

logger.info({ port: 3000 }, 'API server listening');
```

`wrapFetch` is the analogue of `app.use(createExpressLogger())`. The handler's
`req` is `LoggedRequest = Request & { log: Logger; id: number }`, mirroring
`pino-http`'s `req.log` / `req.id`. Bun `Request` instances are extensible
(verified on Bun 1.3.14), so the property is assigned directly rather than
routed through a `WeakMap` lookup helper.

Wrapping the handler was chosen over wrapping the whole options object or
replacing `Bun.serve` outright. Both alternatives would make this package own
Bun's option surface — `tls`, `unix`, `websocket`, `routes`, `idleTimeout` — and
track it across Bun releases, for no gain in Express similarity.

### Types

```ts
export interface CreateBunLoggerOptions extends CreateLoggerOptions {
  /** Emit the access log line for each request (default: true) */
  autoLogging?: boolean;
  /** Derive `ip` from x-forwarded-for (default: true) */
  forwardedIp?: boolean;
  /** Override the output stream. Defaults to the resolved format's stream. */
  destination?: DestinationStream;
}

/** Structural subset of Bun's `Server`; avoids a build-time dep on Bun types. */
export interface RequestIPProvider {
  requestIP?(req: Request): {
    address: string;
    port: number;
    family: string;
  } | null;
}

export type LoggedRequest = Request & { log: Logger; id: number };

export interface BunLogger {
  logger: Logger;
  wrapFetch<S extends RequestIPProvider>(
    handler: (req: LoggedRequest, server: S) => Response | Promise<Response>,
  ): (req: Request, server: S) => Promise<Response>;
}

export function createBunLogger(options?: CreateBunLoggerOptions): BunLogger;
```

`destination` exists because the access-log record is the entire contract of
this package and it must be assertable in a unit test. `createLogger` writes to
fd 1 through `sonic-boom` when the format is `json`, which bypasses
`process.stdout.write` and so cannot be captured by monkey-patching. Injecting
the stream is the smallest way to make the output testable, and doubles as a way
to route access logs somewhere other than stdout.

## Field derivation

| Field | Source |
| --- | --- |
| `req.id` | Per-`createBunLogger` counter, starts at 1 |
| `req.method` | `req.method` |
| `req.url` | `url.pathname + url.search` — path and query, not the absolute URL |
| `req.query` | `Object.fromEntries(url.searchParams)` |
| `req.params` | Always `{}` |
| `req.headers` | `Object.fromEntries(req.headers)` |
| `req.remoteAddress` | `server.requestIP(req)?.address` |
| `req.remotePort` | `server.requestIP(req)?.port` |
| `ip` | First `x-forwarded-for` entry, trimmed; else `remoteAddress` |
| `res.statusCode` | `response.status` |
| `res.headers` | `Object.fromEntries(response.headers)` |
| `responseTime` | `Math.round(performance.now() - start)` |

`req.params` is hardcoded to `{}` rather than omitted. Bun's fetch handler has
no route-params concept, but keeping the key present means a dashboard or query
written against Express logs does not have to special-case Bun services.

`ip` is emitted **only** when `forwardedIp` is true. This matches
`packages/logging-express/src/express.ts:42`, where the `customProps` hook that
produces `ip` is omitted entirely when the flag is off — the field is absent,
not null.

`remoteAddress` / `remotePort` are omitted when `server.requestIP` is
unavailable or returns null, rather than emitted as null.

## Behaviour

**Success.** Log after the handler resolves:

```ts
logger.info({ req, ip, res, responseTime }, 'request completed');
```

Merge-object key order is the emitted key order under Pino, so the object
literal is written in the order the baseline shows.

**Throw.** Log at `INFO` with `msg: 'request errored'`, then **rethrow** so
Bun's own `error` handler decides the response. The `err` field carries the
**real caught error**, serialized by `serializeError` from `@x1-labs/logging`.

This is a deliberate divergence from Express. There, `pino-http` runs after the
error middleware has already turned the throw into a 500, so it synthesizes a
useless `Error: failed with status code 500` whose stack points into
`pino-http/logger.js`. Bun has no error middleware, so the wrapper holds the
actual error. Field name and `msg` are unchanged; only the stack improves.

`res` is **omitted** on a throw. No `Response` exists at that point, and Bun's
`error` handler may return any status, so emitting `statusCode: 500` would be a
fabrication. Queries for failed requests should match `msg="request errored"`.

**Log level.** Always `info`, for every status. Matches Express exactly, per the
baseline. A 500 is therefore not distinguishable by level — filter on
`res.statusCode` instead. No `customLogLevel` option is provided.

**`autoLogging: false`.** Suppresses the access-log line but still attaches
`req.log` and `req.id`, matching `pino-http`.

**Streaming responses.** For an SSE endpoint like warp-bridge's
`/transactions/stream`, the handler returns as soon as headers are ready, so the
line is emitted then and `responseTime` measures time-to-headers, not stream
duration. Express has the same limitation; `pino-http` merely hides it behind
`res.on('finish')`.

## Configuration

Resolution is delegated wholesale to `@x1-labs/logging` — `resolveLogLevel`,
`resolveLogFormat`, `resolveDestination`, `resolveTimestamp`, `resolveBase`, and
`serializeError`. `LOG_LEVEL`, `LOG_FORMAT`, `LOG_OMIT_FIELDS` and
`LOG_TIMESTAMP` therefore behave identically to the other three packages, with
no per-package env handling.

## Package layout

```
packages/logging-bun/
  package.json          @x1-labs/logging-bun
  tsconfig.json         extends root, outDir ./dist, rootDir ./src
  tsconfig.build.json   excludes **/*.spec.ts
  src/index.ts          re-exports
  src/bun.ts            createBunLogger
  src/bun.test.ts       parity tests
```

`package.json` mirrors `packages/logging-express/package.json`: same scripts,
`main`/`types`/`exports`, `files: ["dist"]`, MIT. Dependencies `@x1-labs/logging`
and `pino`; optional peer `pino-pretty`. **No `bun` or `@types/bun` dependency** —
the source references no `Bun` global, only standard `Request`/`Response` and the
structural `RequestIPProvider`. `@types/bun` is already a root devDependency for
the tests.

## Testing

`bun test packages/*/src` is already wired at the repo root.

Unit tests inject `destination` as an in-memory collector:

- full record parity against the captured Express baseline — exact key set and
  key order for the top level, `req`, and `res`
- `req.id` increments from 1
- `ip` from `x-forwarded-for` with multiple entries; falls back to
  `remoteAddress`; absent entirely when `forwardedIp: false`
- `url` and `query` for a request with a query string; `params` is `{}`
- 404 and 500 responses both log at `INFO` with `request completed`
- a throwing handler logs `request errored` with the real error, omits `res`,
  and the throw propagates to the caller
- `autoLogging: false` emits no line but still provides `req.log` / `req.id`

One integration test runs a real `Bun.serve` on port 0 with an injected
destination, to cover `server.requestIP` — the one field no unit test can fake
honestly.

## Repo changes outside the new package

- `scripts/bump-version.sh:18` iterates a hardcoded list of nested packages.
  Replace it with a `packages/logging-*/package.json` glob so this package and
  any future one get their `@x1-labs/logging` dependency bumped.
- `README.md`: add the package to the table at line 11, plus an install line and
  a usage example alongside the Express one at line 45.
- `CLAUDE.md`: add the package to the Project Overview and Architecture sections
  and to the three-package split note under Key Design Decisions.

## Delivery

Feature branch, then a PR against `main`.
