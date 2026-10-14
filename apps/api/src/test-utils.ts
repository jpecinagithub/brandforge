/**
 * Integration-test helpers (vitest `integration` project only — never imported
 * by runtime code). Builds the real Fastify app via buildApp() and drives it
 * with fastify.inject against the `brandforge_test` database.
 */
import { randomUUID } from 'node:crypto';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { sql } from 'drizzle-orm';
import { buildApp } from './index.js';
import { closeDb, getDb } from './db.js';
import { clearMaildir, emlCount, extractTokenFromEml, newestEml } from './test-mail.js';

export { clearMaildir, closeDb, emlCount, extractTokenFromEml, newestEml };

const TABLES = [
  'agent_tool_calls',
  'agent_steps',
  'agent_runs',
  'model_usage',
  'usage_quotas',
  'settings',
  'audit_logs',
  'messages',
  'conversations',
  'landing_pages',
  'design_documents',
  'assets',
  'brand_kits',
  'campaigns',
  'projects',
  'workspace_members',
  'workspaces',
  'sessions',
  'password_reset_tokens',
  'email_verification_tokens',
  'users',
];

/** Build the real app (same as production bootstrap, minus listen()). */
export async function buildTestApp(): Promise<FastifyInstance> {
  const app = await buildApp();
  await app.ready();
  return app;
}

/** Wipe every table so each test starts from a clean database. */
export async function truncateDb(): Promise<void> {
  await getDb().execute(sql.raw(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`));
}

// ---------------------------------------------------------------- http

/** Extract the `bf_session=<token>` pair from a login Set-Cookie header. */
export function sessionCookieValue(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : [raw as string];
  const found = list.find((s) => typeof s === 'string' && s.startsWith('bf_session='));
  if (!found) throw new Error('no bf_session cookie in response');
  return (found as string).split(';')[0];
}

export function authed(cookie: string, opts: InjectOptions = {}): InjectOptions {
  return { ...opts, headers: { ...(opts.headers ?? {}), cookie } };
}

let emailSeq = 0;
export function uniqueEmail(prefix = 't'): string {
  emailSeq += 1;
  return `${prefix}-${Date.now()}-${emailSeq}-${randomUUID().slice(0, 8)}@test.brandforge.local`;
}

export const GOOD_PASSWORD = 'Str0ngPassw0rd';

export interface TestUser {
  cookie: string;
  user: { id: string; email: string; name: string };
}

/** Full happy path: register → verify via maildir token → login (session cookie). */
export async function registerVerifyLogin(
  app: FastifyInstance,
  overrides: { email?: string; name?: string; password?: string } = {},
): Promise<TestUser> {
  const email = overrides.email ?? uniqueEmail('user');
  const name = overrides.name ?? 'Test User';
  const password = overrides.password ?? GOOD_PASSWORD;

  const reg = await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { name, email, password } });
  if (reg.statusCode !== 201) throw new Error(`register failed: ${reg.statusCode} ${reg.body}`);

  const token = extractTokenFromEml(await newestEml());
  const verify = await app.inject({ method: 'POST', url: '/api/v1/auth/verify-email', payload: { token } });
  if (verify.statusCode !== 200) throw new Error(`verify failed: ${verify.statusCode} ${verify.body}`);

  const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
  if (login.statusCode !== 200) throw new Error(`login failed: ${login.statusCode} ${login.body}`);

  const cookie = sessionCookieValue(login);
  const user = (login.json() as { user: TestUser['user'] }).user;
  return { cookie, user };
}

/** Create a workspace owned by the given session; returns its id. */
export async function createWorkspace(app: FastifyInstance, cookie: string, name = 'Test workspace'): Promise<string> {
  const res = await app.inject(authed(cookie, { method: 'POST', url: '/api/v1/workspaces', payload: { name } }));
  if (res.statusCode !== 201) throw new Error(`workspace create failed: ${res.statusCode} ${res.body}`);
  return (res.json() as { workspace: { id: string } }).workspace.id;
}
