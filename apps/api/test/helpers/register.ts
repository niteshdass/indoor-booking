import type express from 'express';
import request from 'supertest';

let seq = 0;

/** Registers through the phone-first flow (the test services' OTP is always 123456); each call gets a fresh number unless one is given. */
export async function registerAccount(
  app: express.Express,
  body: { name: string; email: string; password: string },
  phone = `+8801711${String((seq += 1)).padStart(6, '0')}`,
) {
  await request(app).post('/api/v1/auth/register/otp/request').send({ phone });
  return request(app).post('/api/v1/auth/register').send({ ...body, phone, code: '123456' });
}
