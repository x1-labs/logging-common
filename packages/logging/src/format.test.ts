import { afterEach, describe, expect, it } from 'bun:test';
import { resolveLogFormat } from './format';

const ORIGINAL_ENV = process.env.LOG_FORMAT;
const ORIGINAL_ISTTY = process.stdout.isTTY;

function setTty(isTty: boolean | undefined): void {
  // isTTY is a plain own property on the stream, so it can be swapped for a test.
  Object.defineProperty(process.stdout, 'isTTY', {
    value: isTty,
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  if (ORIGINAL_ENV === undefined) delete process.env.LOG_FORMAT;
  else process.env.LOG_FORMAT = ORIGINAL_ENV;
  setTty(ORIGINAL_ISTTY);
});

describe('resolveLogFormat', () => {
  describe('with no override and no LOG_FORMAT', () => {
    it('is pretty on an interactive terminal', () => {
      delete process.env.LOG_FORMAT;
      setTty(true);

      expect(resolveLogFormat()).toBe('pretty');
    });

    it('is json when stdout is not a terminal', () => {
      delete process.env.LOG_FORMAT;
      setTty(false);

      expect(resolveLogFormat()).toBe('json');
    });

    it('is json when isTTY is absent, which is how node reports a pipe', () => {
      delete process.env.LOG_FORMAT;
      setTty(undefined);

      expect(resolveLogFormat()).toBe('json');
    });
  });

  describe('LOG_FORMAT wins over the terminal check', () => {
    it('honours pretty even when piped', () => {
      process.env.LOG_FORMAT = 'pretty';
      setTty(false);

      expect(resolveLogFormat()).toBe('pretty');
    });

    it('honours json even on a terminal', () => {
      process.env.LOG_FORMAT = 'json';
      setTty(true);

      expect(resolveLogFormat()).toBe('json');
    });

    it('honours logfmt', () => {
      process.env.LOG_FORMAT = 'logfmt';
      setTty(true);

      expect(resolveLogFormat()).toBe('logfmt');
    });

    it('is case insensitive', () => {
      process.env.LOG_FORMAT = 'JSON';
      setTty(true);

      expect(resolveLogFormat()).toBe('json');
    });

    it('falls back to the terminal check when the value is unrecognised', () => {
      process.env.LOG_FORMAT = 'yaml';
      setTty(false);

      expect(resolveLogFormat()).toBe('json');
    });
  });

  describe('explicit override wins over everything', () => {
    it('takes a format directly', () => {
      process.env.LOG_FORMAT = 'json';
      setTty(true);

      expect(resolveLogFormat('logfmt')).toBe('logfmt');
    });

    it('maps the legacy json:true option', () => {
      setTty(true);

      expect(resolveLogFormat(true)).toBe('json');
    });

    it('maps the legacy json:false option to pretty, even when piped', () => {
      process.env.LOG_FORMAT = 'json';
      setTty(false);

      expect(resolveLogFormat(false)).toBe('pretty');
    });
  });
});
