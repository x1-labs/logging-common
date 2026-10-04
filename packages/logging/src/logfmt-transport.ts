import build from 'pino-abstract-transport';
import { formatLogfmt } from './logfmt';
import type { LogfmtOptions, LogObject } from './logfmt';

export type LogfmtTransportOptions = LogfmtOptions;

/**
 * Custom logfmt transport with field ordering: time, level, name, msg, ...rest
 */
export default async function (opts: LogfmtTransportOptions = {}) {
  return build(async function (source) {
    for await (const obj of source) {
      process.stdout.write(formatLogfmt(obj as LogObject, opts) + '\n');
    }
  });
}
