/**
 * Pino's default error serializer (`pino.stdSerializers.err`) collects properties
 * with a `for...in` loop, which walks the prototype chain. Most runtimes keep
 * built-in error properties non-enumerable, so this is usually invisible. Bun's
 * `DOMException` does not: its 25 legacy constants (`INDEX_SIZE_ERR`,
 * `DATA_CLONE_ERR`, ...) are inherited *and* enumerable, so every `fetch` timeout
 * logs 25 junk fields alongside the useful ones.
 *
 * This serializer reads named properties explicitly and copies only own
 * enumerable ones, so nothing arrives from a prototype.
 */

/** Non-enumerable or inherited properties worth keeping when present. */
const WELL_KNOWN_KEYS = [
  'code',
  'errno',
  'syscall',
  'path',
  'address',
  'port',
] as const;

type SerializedError = Record<string, unknown>;

/**
 * Serialize an Error for logging, mirroring the shape of Pino's default
 * serializer (`type`, `message`, `stack`, plus extras) without inheriting
 * prototype junk.
 *
 * Non-Error values are returned untouched, matching Pino's behaviour.
 */
export function serializeError(err: unknown): unknown {
  if (!(err instanceof Error)) {
    return err;
  }

  const type = err.constructor?.name ?? 'Error';
  const output: SerializedError = {
    type,
    message: err.message,
    stack: err.stack,
  };

  // `name` duplicates `type` for a plain Error; it is only interesting when a
  // subclass sets it independently, as DOMException does (TimeoutError).
  if (err.name && err.name !== type) {
    output.name = err.name;
  }

  for (const key of WELL_KNOWN_KEYS) {
    const value = (err as unknown as SerializedError)[key];
    if (value !== undefined) {
      output[key] = value;
    }
  }

  // Own enumerable properties: custom fields the caller attached to the error.
  for (const key of Object.keys(err)) {
    if (!(key in output)) {
      output[key] = (err as unknown as SerializedError)[key];
    }
  }

  if (err.cause !== undefined) {
    output.cause = serializeError(err.cause);
  }

  return output;
}
