/**
 * Integration: full auth lifecycle via fastify.inject against brandforge_test.
 * register → verify (token from maildir) → login (cookie) → me → logout → 401.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  GOOD_PASSWORD,
  authed,
  buildTestApp,
  clearMaildir,
  closeDb,
  createWorkspace,
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

describe('auth lifecycle', () => {
  it('register → verify → login → me → logout → 401', async () => {
    const email = uniqueEmail('lifecycle');

    const reg = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { name: 'Ada Lovelace', email, password: GOOD_PASSWORD },
    });
    expect(reg.statusCode).toBe(201);
    expect(reg.json().user.status).toBe('pending');

    // verification email landed in the maildir; token is single-use
    const eml = await newestEml();
    expect(eml).toMatch(/Verify your BrandForge account/);
    const token = extractTokenFromEml(eml);

    const verify = await app.inject({ method: 'POST', url: '/api/v1/auth/verify-email', payload: { token } });
    expect(verify.statusCode).toBe(200);
    expect(verify.json().user.status).toBe('active');

    const reuse = await app.inject({ method: 'POST', url: '/api/v1/auth/verify-email', payload: { token } });
    expect(reuse.statusCode).toBe(400);
    expect(reuse.json().error.code).toBe('INVALID_TOKEN');

    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password: GOOD_PASSWORD } });
    expect(login.statusCode).toBe(200);
    const cookie = sessionCookieValue(login);

    const me = await app.inject(authed(cookie, { method: 'GET', url: '/api/v1/auth/me' }));
    expect(me.statusCode).toBe(200);
    expect(me.json().user.email).toBe(email);

    const logout = await app.inject(authed(cookie, { method: 'POST', url: '/api/v1/auth/logout' }));
    expect(logout.statusCode).toBe(200);

    const after = await app.inject(authed(cookie, { method: 'GET', url: '/api/v1/auth/me' }));
    expect(after.statusCode).toBe(401);
    expect(after.json().error.code).toBe('UNAUTHORIZED');
  });

  it('rejects login before email verification (403)', async () => {
    const email = uniqueEmail('unverified');
    await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { name: 'N', email, password: GOOD_PASSWORD } });
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password: GOOD_PASSWORD } });
    expect(login.statusCode).toBe(403);
    expect(login.json().error.code).toBe('EMAIL_NOT_VERIFIED');
  });

  it('rejects wrong password (401) and unknown email (401, neutral)', async () => {
    const { user } = await registerVerifyLogin(app);
    const bad = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: user.email, password: 'Wr0ngPassw0rd1' },
    });
    expect(bad.statusCode).toBe(401);
    expect(bad.json().error.code).toBe('INVALID_CREDENTIALS');

    const unknown = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: uniqueEmail('ghost'), password: GOOD_PASSWORD },
    });
    expect(unknown.statusCode).toBe(401);
    expect(unknown.json().error.code).toBe('INVALID_CREDENTIALS');
  });

  it('rejects weak password / bad email at registration (422) and duplicate email (409)', async () => {
    const weak = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { name: 'N', email: uniqueEmail('weak'), password: 'weak' },
    });
    expect(weak.statusCode).toBe(422);
    expect(weak.json().error.code).toBe('VALIDATION_ERROR');

    const email = uniqueEmail('dupe');
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { name: 'N', email, password: GOOD_PASSWORD },
    });
    expect(first.statusCode).toBe(201);
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { name: 'N', email, password: GOOD_PASSWORD },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe('EMAIL_TAKEN');
  });

  it('rejects malformed UUID route params with 400 (global guard)', async () => {
    const { cookie } = await registerVerifyLogin(app);
    const res = await app.inject(authed(cookie, { method: 'GET', url: '/api/v1/projects/not-a-uuid' }));
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('BAD_REQUEST');
  });

  it('a verified user can create a workspace as owner', async () => {
    const { cookie } = await registerVerifyLogin(app);
    const wsId = await createWorkspace(app, cookie, 'My workspace');
    const list = await app.inject(authed(cookie, { method: 'GET', url: '/api/v1/workspaces' }));
    expect(list.statusCode).toBe(200);
    const ws = (
      list.json() as { workspaces: Array<{ id: string; name: string; role: string }> }
    ).workspaces;
    // Registration auto-creates a "Personal workspace", so creating one more makes 2.
    expect(ws).toHaveLength(2);
    expect(ws.map((w) => w.name).sort()).toEqual(['My workspace', 'Personal workspace']);
    const created = ws.find((w) => w.id === wsId);
    expect(created?.role).toBe('owner');
  });
});
