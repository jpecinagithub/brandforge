/**
 * Integration: login rate limiting (max 20 attempts / 15 min per IP).
 * The 21st rapid login attempt must be rejected with 429 RATE_LIMITED.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp, clearMaildir, closeDb, truncateDb, uniqueEmail } from '../test-utils.js';

let app: FastifyInstance;

beforeAll(async () => {
  await truncateDb();
  await clearMaildir();
  app = await buildTestApp(); // fresh app → fresh in-memory rate-limit store
});
afterAll(async () => {
  await app.close();
  await closeDb();
});

describe('login rate limit', () => {
  it('returns 429 on the 21st rapid login attempt', async () => {
    const email = uniqueEmail('ratelimit');
    const statuses: number[] = [];
    for (let i = 0; i < 21; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email, password: 'Wr0ngPassw0rd1' },
      });
      statuses.push(res.statusCode);
    }
    // first 20 pass through to credential checking (401), the 21st is limited
    expect(statuses.slice(0, 20).every((s) => s === 401)).toBe(true);
    expect(statuses[20]).toBe(429);

    const last = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password: 'Wr0ngPassw0rd1' },
    });
    expect(last.statusCode).toBe(429);
    expect(last.json().error.code).toBe('RATE_LIMITED');
  });
});
