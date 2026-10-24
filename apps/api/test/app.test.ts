import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { z } from 'zod';
import { createApp } from '../src/app';
import { AppError } from '../src/errors';
import type { Config } from '../src/config';
import { makeTestServices } from './helpers/testServices';

const config: Config = {
  nodeEnv: 'test',
  port: 0,
  mongodbUri: 'mongodb://unused',
  corsOrigin: 'http://localhost:5173',
  jwtSecret: 'x'.repeat(32),
  appUrl: 'http://localhost:5173',
  apiUrl: 'http://localhost:4000',
};

const app = createApp({
  config,
  dbState: () => 'up',
  services: makeTestServices(),
  extraRoutes: (router) => {
    router.get('/__test/conflict', () => {
      throw new AppError(409, 'slot_taken', 'Slot taken');
    });
    router.get('/__test/crash', () => {
      throw new Error('secret db detail');
    });
    router.post('/__test/echo', (req, res) => {
      res.json(z.object({ n: z.number() }).parse(req.body));
    });
  },
});

describe('app', () => {
  it('GET /api/v1/health reports db state', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', db: 'up' });
  });
  it('unknown route → 404 not_found', async () => {
    const res = await request(app).get('/api/v1/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
  });
  it('AppError keeps status and code', async () => {
    const res = await request(app).get('/api/v1/__test/conflict');
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: { code: 'slot_taken', message: 'Slot taken' } });
  });
  it('unexpected error → 500 without leaking details', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await request(app).get('/api/v1/__test/crash');
    spy.mockRestore();
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: { code: 'internal_error', message: 'Internal server error' } });
    expect(JSON.stringify(res.body)).not.toContain('secret');
  });
  it('malformed JSON → 400 invalid_json', async () => {
    const res = await request(app)
      .post('/api/v1/__test/echo')
      .set('Content-Type', 'application/json')
      .send('{"a":');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_json');
  });
  it('oversized JSON body → 413 payload_too_large, not 500', async () => {
    const res = await request(app)
      .post('/api/v1/__test/echo')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ n: 1, pad: 'x'.repeat(200_000) }));
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('payload_too_large');
  });
  it('unsupported charset → 415 unsupported_media_type, not 500', async () => {
    const res = await request(app)
      .post('/api/v1/__test/echo')
      .set('Content-Type', 'application/json; charset=bogus')
      .send('{"n":1}');
    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe('unsupported_media_type');
  });
  it('ZodError → 400 validation_error with issues in details', async () => {
    const res = await request(app).post('/api/v1/__test/echo').send({ n: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
    expect(Array.isArray(res.body.error.details)).toBe(true);
  });
});
