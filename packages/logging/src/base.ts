import type { LoggerOptions } from 'pino';

const DEFAULT_OMIT_FIELDS = 'pid,hostname';

/**
 * Resolves the Pino `base` option from the LOG_OMIT_FIELDS environment variable.
 *
 * Set LOG_OMIT_FIELDS to a comma-separated list of fields to omit from log output.
 * Default: "pid,hostname" (omits both, suitable for K8s environments)
 *
 * To include all default Pino fields, set LOG_OMIT_FIELDS=none
 *
 * @returns The `base` option for Pino, or undefined if no fields should be omitted
 */
export function resolveBase(): LoggerOptions['base'] {
  const omitFields = process.env.LOG_OMIT_FIELDS ?? DEFAULT_OMIT_FIELDS;

  if (omitFields === 'none' || omitFields === '') {
    return undefined;
  }

  const fields = omitFields.split(',').map((f) => f.trim().toLowerCase());
  const base: Record<string, undefined> = {};

  for (const field of fields) {
    if (field) {
      base[field] = undefined;
    }
  }

  return Object.keys(base).length > 0 ? base : undefined;
}
