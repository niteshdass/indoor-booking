import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { AddonQuoteError, BookingQuoteError, InvalidMoneyError } from '@booking/shared';
import { buildTestApp } from './helpers/testApp';

function appThrowing(err: Error) {
  return buildTestApp({
    extraRoutes: (router) => {
      router.get('/boom', () => {
        throw err;
      });
    },
  }).app;
}

describe('errorHandler quote errors', () => {
  it('maps addon_out_of_stock to 409 with addonId', async () => {
    const res = await request(appThrowing(new AddonQuoteError('addon_out_of_stock', 'x'))).get('/api/v1/boom');
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'addon_out_of_stock', details: { addonId: 'x' } });
  });

  it('maps other addon codes to 400', async () => {
    const res = await request(appThrowing(new AddonQuoteError('addon_unavailable', 'x'))).get('/api/v1/boom');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ code: 'addon_unavailable', details: { addonId: 'x' } });
  });

  it('maps BookingQuoteError to 400 with startAt', async () => {
    const res = await request(appThrowing(new BookingQuoteError('slots_not_consecutive'))).get('/api/v1/boom');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ code: 'slots_not_consecutive', details: { startAt: null } });
  });

  it('maps InvalidMoneyError to 400 invalid_amount', async () => {
    const res = await request(appThrowing(new InvalidMoneyError('bad'))).get('/api/v1/boom');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_amount');
  });
});
