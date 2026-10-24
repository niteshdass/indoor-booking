import { describe, it, expect } from 'vitest';
import i18n from '../src/i18n';
import { ApiError } from '../src/lib/apiClient';
import { errorMessage } from '../src/lib/errors';

const t = i18n.t.bind(i18n);

describe('errorMessage', () => {
  it('maps known codes, unknown codes, network failures and foreign errors', async () => {
    await i18n.changeLanguage('en');
    expect(errorMessage(new ApiError(409, 'slot_taken', 'x'), t)).toBe(i18n.t('errors.slot_taken'));
    expect(errorMessage(new ApiError(400, 'weird', 'x'), t)).toBe(i18n.t('errors.generic'));
    expect(errorMessage(new ApiError(0, 'network_error', 'x'), t)).toBe(i18n.t('errors.network_error'));
    expect(errorMessage(new Error('boom'), t)).toBe(i18n.t('errors.generic'));
  });
});
