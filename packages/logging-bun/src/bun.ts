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
  const forwardedIp = options.forwardedIp ?? true;

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

  /**
   * The first x-forwarded-for entry, falling back to the peer address.
   *
   * Mirrors the express package's customProps hook, with one deliberate
   * divergence: express uses `??`, so an x-forwarded-for header that is present
   * but empty logs `ip: ""`. The `||` below falls back to the peer address in
   * that case instead, which is never blank.
   */
  function resolveIp(
    req: Request,
    peer: { address: string } | null,
  ): string | undefined {
    const forwarded = req.headers.get('x-forwarded-for');
    return forwarded?.split(',')[0]?.trim() || peer?.address;
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

      const peer = server?.requestIP?.(req) ?? null;
      const ip = forwardedIp ? resolveIp(req, peer) : undefined;

      const child = logger.child({
        req: serializeRequest(req, id, peer),
        ...(ip !== undefined ? { ip } : {}),
      });

      const logged = req as LoggedRequest;
      logged.id = id;
      logged.log = child;

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
        // pino-http branches on `err || res.statusCode >= 500` and synthesizes
        // an Error from the status code, so express reports a *returned* 5xx
        // exactly like a thrown one: `request errored`, still at info, with an
        // `err`. Mirrored here so one `msg="request errored"` query catches
        // failures across express and bun services alike.
        //
        // `res` stays, unlike the thrown path above -- a Response really does
        // exist here, and express carries it too.
        const errored = res.status >= 500;
        child.info(
          {
            res: serializeResponse(res),
            ...(errored
              ? { err: new Error(`failed with status code ${res.status}`) }
              : {}),
            responseTime: Math.round(performance.now() - start),
          },
          errored ? 'request errored' : 'request completed',
        );
      }

      return res;
    };
  }

  return { logger, wrapFetch };
}
