import type { TFunction } from 'i18next';
import { ApiError } from './api';

/**
 * User-facing text for an error: `errors.<code>` when translated, else `errors.generic`.
 * Copied from apps/web/src/lib/errors.ts rather than shared: the web file imports the web ApiError class,
 * and `instanceof` would not match this app's own ApiError.
 */
export function errorMessage(err: unknown, t: TFunction): string {
  if (!(err instanceof ApiError)) return t('errors.generic');
  if (err.status === 0) return t('errors.network_error');
  const key = `errors.${err.code}`;
  return t(key, { defaultValue: '' }) || t('errors.generic');
}
