/**
 * Integration: password recovery flow.
 * forgot-password is always a neutral 200 (unknown emails too); a reset
 * consumes the token and revokes all pre-existing sessions.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  GOOD_PASSWORD,
  authed,
  buildTestApp,
  clearMaildir,
  closeDb,
  emlCount,
  extractTokenFromEml,
  newestEml,
  registerVerifyLogin,
  sessionCookieValue,
  truncateDb,
  uniqueEmail,
} from '../test-utils.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildTestApp();
});
afterAll(async () => {
  await app.close();
  await closeDb();
});
beforeEach(async () => {
  await truncateDb();
  await clearMaildir();
});

const NEW_PASSWORD = 'N3wStr0ngPass!';

describe('password recovery', () => {
  it('forgot-password is neutral 200 for unknown emails and sends nothing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/forgot-password',
      payload: { email: uniqueEmail('ghost') },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(await emlCount()).toBe(0);
  });

  it('full reset flow: token from maildir → reset → old password dead, new works', async () => {
    const { user } = await registerVerifyLogin(app);
    await clearMaildir();

    const forgot = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/forgot-password',
      payload: { email: user.email },
    });
    expect(forgot.statusCode).toBe(200);

    const eml = await newestEml();
    expect(eml).toMatch(/Reset your BrandForge password/);
    const token = extractTokenFromEml(eml);

    const reset = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/reset-password',
      payload: { token, password: NEW_PASSWORD },
    });
    expect(reset.statusCode).toBe(200);

    const oldLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: user.email, password: GOOD_PASSWORD },
    });
    expect(oldLogin.statusCode).toBe(401);

    const newLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: user.email, password: NEW_PASSWORD },
    });
    expect(newLogin.statusCode).toBe(200);
  });

  it('rejects bogus and already-used reset tokens', async () => {
    const { user } = await registerVerifyLogin(app);
    await clearMaildir();
    await app.inject({ method: 'POST', url: '/api/v1/auth/forgot-password', payload: { email: user.email } });
    const token = extractTokenFromEml(await newestEml());

    const bogus = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/reset-password',
      payload: { token: 'bogus-token-value', password: NEW_PASSWORD },
    });
    expect(bogus.statusCode).toBe(400);
    expect(bogus.json().error.code).toBe('INVALID_TOKEN');

    const ok = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/reset-password',
      payload: { token, password: NEW_PASSWORD },
    });
    expect(ok.statusCode).toBe(200);

    const reuse = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/reset-password',
      payload: { token, password: 'An0therStr0ng!' },
    });
    expect(reuse.statusCode).toBe(400);
  });

  it('reset revokes all pre-existing sessions', async () => {
    const { user, cookie: cookieA } = await registerVerifyLogin(app);
    const loginB = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: user.email, password: GOOD_PASSWORD },
    });
    const cookieB = sessionCookieValue(loginB);

    await clearMaildir();
    await app.inject({ method: 'POST', url: '/api/v1/auth/forgot-password', payload: { email: user.email } });
    const token = extractTokenFromEml(await newestEml());
    await app.inject({ method: 'POST', url: '/api/v1/auth/reset-password', payload: { token, password: NEW_PASSWORD } });

    for (const cookie of [cookieA, cookieB]) {
      const me = await app.inject(authed(cookie, { method: 'GET', url: '/api/v1/auth/me' }));
      expect(me.statusCode).toBe(401);
    }

    // …but a fresh login after the reset works
    const fresh = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: user.email, password: NEW_PASSWORD },
    });
    expect(fresh.statusCode).toBe(200);
  });
});
