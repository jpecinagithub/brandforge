/**
 * Integration: the demo flow (POST /api/v1/auth/demo).
 * A demo sign-in mints an isolated demo user + workspace seeded with the
 * "Café Aroma" sample project; demo users cannot see other users' projects.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  authed,
  buildTestApp,
  clearMaildir,
  closeDb,
  createWorkspace,
  registerVerifyLogin,
  sessionCookieValue,
  truncateDb,
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

async function createDemo() {
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/demo', payload: {} });
  expect(res.statusCode).toBe(200);
  const body = res.json() as {
    user: { id: string; isDemo: boolean };
    workspace: { id: string; name: string; isDemo: boolean; role: string };
  };
  return { body, cookie: sessionCookieValue(res) };
}

describe('demo flow', () => {
  it('mints an isolated demo user + workspace owned by that user', async () => {
    const { body, cookie } = await createDemo();
    expect(body.user.isDemo).toBe(true);
    expect(body.workspace.isDemo).toBe(true);
    expect(body.workspace.role).toBe('owner');

    const list = await app.inject(authed(cookie, { method: 'GET', url: '/api/v1/workspaces' }));
    const workspaces = (list.json() as { workspaces: Array<{ id: string; isDemo: boolean }> }).workspaces;
    expect(workspaces).toHaveLength(1);
    expect(workspaces[0].id).toBe(body.workspace.id);
    expect(workspaces[0].isDemo).toBe(true);
  });

  it('seeds the Café Aroma sample project into the demo workspace', async () => {
    const { body, cookie } = await createDemo();
    const res = await app.inject(
      authed(cookie, { method: 'GET', url: `/api/v1/projects?workspaceId=${body.workspace.id}` }),
    );
    expect(res.statusCode).toBe(200);
    const names = (res.json() as { projects: Array<{ name: string }> }).projects.map((p) => p.name);
    expect(names).toContain('Café Aroma — Christmas Campaign');
  });

  it('two demos are isolated from each other', async () => {
    const a = await createDemo();
    const b = await createDemo();
    expect(a.body.user.id).not.toBe(b.body.user.id);
    expect(a.body.workspace.id).not.toBe(b.body.workspace.id);

    const listB = await app.inject(authed(b.cookie, { method: 'GET', url: '/api/v1/workspaces' }));
    const ids = (listB.json() as { workspaces: Array<{ id: string }> }).workspaces.map((w) => w.id);
    expect(ids).not.toContain(a.body.workspace.id);
  });

  it('a demo user gets 404 (not 403) on another user\u2019s project — no existence leak', async () => {
    const real = await registerVerifyLogin(app);
    const wsId = await createWorkspace(app, real.cookie, 'Real workspace');
    const created = await app.inject(
      authed(real.cookie, {
        method: 'POST',
        url: '/api/v1/projects',
        payload: { workspaceId: wsId, name: 'Private project' },
      }),
    );
    const projectId = (created.json() as { project: { id: string } }).project.id;

    const demo = await createDemo();
    const peek = await app.inject(authed(demo.cookie, { method: 'GET', url: `/api/v1/projects/${projectId}` }));
    expect(peek.statusCode).toBe(404);

    const peekWs = await app.inject(authed(demo.cookie, { method: 'GET', url: `/api/v1/workspaces/${wsId}` }));
    expect(peekWs.statusCode).toBe(404);
  });
});
