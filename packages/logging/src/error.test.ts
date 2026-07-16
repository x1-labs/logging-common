import { describe, expect, it } from 'bun:test';
import { serializeError } from './error';

describe('serializeError', () => {
  it('serializes a plain Error to type, message and stack', () => {
    const result = serializeError(new Error('boom')) as Record<string, unknown>;

    expect(result.type).toBe('Error');
    expect(result.message).toBe('boom');
    expect(result.stack).toContain('boom');
  });

  it('omits name when it only duplicates type', () => {
    const result = serializeError(new Error('boom')) as Record<string, unknown>;

    expect(result).not.toHaveProperty('name');
  });

  it('keeps name when a subclass sets it independently', () => {
    const err = new DOMException('The operation timed out.', 'TimeoutError');
    const result = serializeError(err) as Record<string, unknown>;

    expect(result.type).toBe('DOMException');
    expect(result.name).toBe('TimeoutError');
  });

  it('drops the inherited DOMException constants', () => {
    // Bun exposes these as inherited enumerable properties, so a for...in based
    // serializer emits all 25 of them on every fetch timeout.
    const err = new DOMException('The operation timed out.', 'TimeoutError');
    const result = serializeError(err) as Record<string, unknown>;

    expect(result).not.toHaveProperty('INDEX_SIZE_ERR');
    expect(result).not.toHaveProperty('DATA_CLONE_ERR');
    expect(result).not.toHaveProperty('TIMEOUT_ERR');
    expect(Object.keys(result).sort()).toEqual([
      'code',
      'message',
      'name',
      'stack',
      'type',
    ]);
  });

  it('keeps well-known properties that are not own-enumerable', () => {
    const err = new DOMException('The operation timed out.', 'TimeoutError');
    const result = serializeError(err) as Record<string, unknown>;

    // `code` lives on the prototype; dropping the prototype must not lose it.
    expect(result.code).toBe(23);
  });

  it('keeps connection error details', () => {
    const err = Object.assign(new Error('Unable to connect.'), {
      code: 'ConnectionRefused',
      path: 'http://guardian2.us-east.mainnet.x1.infrafc.org:3001/stream',
      errno: 0,
    });
    const result = serializeError(err) as Record<string, unknown>;

    expect(result.code).toBe('ConnectionRefused');
    expect(result.path).toBe(
      'http://guardian2.us-east.mainnet.x1.infrafc.org:3001/stream',
    );
    expect(result.errno).toBe(0);
  });

  it('keeps custom own properties', () => {
    const err = Object.assign(new Error('boom'), { seq: 42, guardian: 'g0' });
    const result = serializeError(err) as Record<string, unknown>;

    expect(result.seq).toBe(42);
    expect(result.guardian).toBe('g0');
  });

  it('serializes a nested cause', () => {
    const err = new Error('outer', { cause: new Error('inner') });
    const result = serializeError(err) as Record<string, unknown>;
    const cause = result.cause as Record<string, unknown>;

    expect(cause.type).toBe('Error');
    expect(cause.message).toBe('inner');
  });

  it('does not emit cause when there is none', () => {
    const result = serializeError(new Error('boom')) as Record<string, unknown>;

    expect(result).not.toHaveProperty('cause');
  });

  it('returns non-Error values untouched', () => {
    expect(serializeError('just a string')).toBe('just a string');
    expect(serializeError(undefined)).toBeUndefined();
    expect(serializeError({ not: 'an error' })).toEqual({ not: 'an error' });
  });

  it('serializes a subclass with its own fields', () => {
    class HttpError extends Error {
      status: number;
      constructor(message: string, status: number) {
        super(message);
        this.status = status;
      }
    }
    const result = serializeError(new HttpError('nope', 503)) as Record<
      string,
      unknown
    >;

    expect(result.type).toBe('HttpError');
    expect(result.status).toBe(503);
  });
});
