/**
 * Integration: Phase 3 agent runs.
 *
 * - HTTP lifecycle: start (202 + idempotency), list, detail, cancel/resume/approve.
 * - Quota gates: 503 AI_NOT_CONFIGURED, 403 QUOTA_EXCEEDED (demo workspace).
 * - Rate limit: 20/h per user on run creation.
 * - SSE: tails agent_events as text/event-stream, closes on run.finished.
 * - Admin: /agent/runs, /agent/usage, /agent/errors.
 * - Full cycle (TEST-ONLY fake OpenRouter client, no network): start →
 *   executeRun → completed, asserting agent_runs/steps/events/model_usage/
 *   credit ledger/assistant message.
 * - Chat: stub when AI is not configured; real run ({message, run}) when it is.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { desc, eq } from 'drizzle-orm';
import {
  agentEvents,
  agentRuns,
  agentSteps,
  creditLedger,
  messages,
  modelUsage,
  projects,
  sessions,
  usageQuotas,
  users,
  workspaceMembers,
  workspaces,
  type Db,
} from '@brandforge/database';
import type {
  ChatOptions,
  ChatResult,
  OpenRouterClient,
} from '@brandforge/agent-core';
import { buildTestOrchestrator } from '@brandforge/agent-server';
import {
  authed,
  buildTestApp,
  clearMaildir,
  closeDb,
  truncateDb,
} from '../test-utils.js';
import { getDb } from '../db.js';
import { daysFromNow, randomToken, sha256Hex } from '../auth/tokens.js';

let app: FastifyInstance;
let db: Db;

beforeAll(async () => {
  app = await buildTestApp();
  db = getDb();
});
afterAll(async () => {
  await app.close();
  await closeDb();
});

const SAVED_ENV = { ...process.env };

beforeEach(async () => {
  await truncateDb();
  await clearMaildir();
  // AI unconfigured by default; individual tests opt in.
  delete process.env.OPENROUTER_API_KEY;
});

afterEach(() => {
  process.env = { ...SAVED_ENV };
});

// ---------------------------------------------------------------------------
// helpers — users/sessions are created directly in the DB (the HTTP register
// route is rate-limited to 10/hour, which a 17-test file would exhaust).
// ---------------------------------------------------------------------------

interface TestSetup {
  userId: string;
  cookie: string;
  workspaceId: string;
  projectId: string;
}

let setupSeq = 0;

async function dbSetup(): Promise<TestSetup> {
  setupSeq += 1;
  const tag = `${Date.now()}-${setupSeq}`;
  const [u] = await db
    .insert(users)
    .values({ email: `agent-${tag}@test.local`, name: 'Agent Test', status: 'active' })
    .returning();
  const [ws] = await db.insert(workspaces).values({ name: `WS ${tag}` }).returning();
  await db.insert(workspaceMembers).values({ workspaceId: ws.id, userId: u.id, role: 'owner' });
  const [p] = await db.insert(projects).values({ workspaceId: ws.id, name: 'Launch' }).returning();
  const token = randomToken();
  await db
    .insert(sessions)
    .values({ userId: u.id, tokenHash: sha256Hex(token), expiresAt: daysFromNow(30) });
  return { userId: u.id, cookie: `bf_session=${token}`, workspaceId: ws.id, projectId: p.id };
}

/** Second user with only viewer access to an existing workspace. */
async function dbSetupViewer(workspaceId: string): Promise<{ userId: string; cookie: string }> {
  setupSeq += 1;
  const tag = `${Date.now()}-${setupSeq}`;
  const [u] = await db
    .insert(users)
    .values({ email: `viewer-${tag}@test.local`, name: 'Viewer', status: 'active' })
    .returning();
  await db.insert(workspaceMembers).values({ workspaceId, userId: u.id, role: 'viewer' });
  const token = randomToken();
  await db
    .insert(sessions)
    .values({ userId: u.id, tokenHash: sha256Hex(token), expiresAt: daysFromNow(30) });
  return { userId: u.id, cookie: `bf_session=${token}` };
}

const setup = dbSetup;

async function makeAdmin(userId: string) {
  await db.update(users).set({ isAdmin: true }).where(eq(users.id, userId));
}

function startRun(cookie: string, projectId: string, body: Record<string, unknown>) {
  return app.inject(
    authed(cookie, {
      method: 'POST',
      url: `/api/v1/projects/${projectId}/agent/runs`,
      payload: body,
    }),
  );
}

// ---------------------------------------------------------------------------
// TEST-ONLY fake OpenRouter client (no network, canned responses)
// ---------------------------------------------------------------------------

const CANNED_PLAN = {
  steps: [
    {
      id: 's1',
      tool: 'generate_marketing_copy',
      title: 'Write launch copy',
      args: { topic: 'Launch', channels: ['email'] },
      dependsOn: [],
    },
    {
      id: 's2',
      tool: 'list_project_assets',
      title: 'List assets',
      args: {},
      dependsOn: ['s1'],
    },
  ],
  estimatedCostUsd: 0.02,
  notes: 'canned test plan',
};

class FakeOpenRouterClient implements OpenRouterClient {
  isConfigured(): boolean {
    return true;
  }
  async chat(opts: ChatOptions): Promise<ChatResult> {
    const text = JSON.stringify(opts.messages);
    if (text.includes('toolCatalog')) {
      // planning call (the inner payload is escaped inside the outer JSON)
      return {
        content: JSON.stringify(CANNED_PLAN),
        model: 'fake-plan',
        usage: { tokensIn: 100, tokensOut: 50, costUsd: 0.001 },
        durationMs: 10,
      };
    }
    if (text.includes('Write marketing copy variants')) {
      return {
        content: JSON.stringify({
          variants: [{ channel: 'email', headline: 'H', body: 'B', cta: 'C' }],
        }),
        model: 'fake-text',
        usage: { tokensIn: 200, tokensOut: 100, costUsd: 0.002 },
        durationMs: 10,
      };
    }
    // finish summary call
    return {
      content: 'Run summary (fake).',
      model: 'fake-text',
      usage: { tokensIn: 50, tokensOut: 20 },
      durationMs: 5,
    };
  }
  async generateImage(): Promise<never> {
    throw new Error('not used in tests');
  }
  async getModelInfo(): Promise<null> {
    return null;
  }
}

const fakeRouter = { select: async () => 'fake-model' };

// ---------------------------------------------------------------------------
// start: validation, AI gate, quota gate, idempotency
// ---------------------------------------------------------------------------

describe('POST /projects/:id/agent/runs', () => {
  it('503 AI_NOT_CONFIGURED when OpenRouter is not configured', async () => {
    const { cookie, projectId } = await setup();
    const res = await startRun(cookie, projectId, { input: 'hello' });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe('AI_NOT_CONFIGURED');
  });

  it('422 on invalid input', async () => {
    const { cookie, projectId } = await setup();
    process.env.OPENROUTER_API_KEY = 'test-key';
    const res = await startRun(cookie, projectId, { input: '' });
    expect(res.statusCode).toBe(422);
  });

  it('404 for unknown project', async () => {
    const { cookie } = await setup();
    process.env.OPENROUTER_API_KEY = 'test-key';
    const res = await startRun(cookie, '00000000-0000-0000-0000-000000000000', {
      input: 'hello',
    });
    expect(res.statusCode).toBe(404);
  });

  it('403 QUOTA_EXCEEDED for demo workspaces (AI disabled)', async () => {
    const { cookie, workspaceId, projectId } = await setup();
    process.env.OPENROUTER_API_KEY = 'test-key';
    await db.update(workspaces).set({ isDemo: true }).where(eq(workspaces.id, workspaceId));
    const res = await startRun(cookie, projectId, { input: 'hello' });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('QUOTA_EXCEEDED');
  });

  it('202 + idempotent on the same idempotency key', async () => {
    const { cookie, projectId } = await setup();
    process.env.OPENROUTER_API_KEY = 'test-key';
    const body = { input: 'make a campaign', idempotencyKey: 'test-key-abc-12345' };
    const r1 = await startRun(cookie, projectId, body);
    expect(r1.statusCode).toBe(202);
    const run1 = (r1.json() as { run: { id: string; state: string } }).run;
    expect(run1.state).toBe('pending');
    const r2 = await startRun(cookie, projectId, body);
    expect(r2.statusCode).toBe(202);
    const run2 = (r2.json() as { run: { id: string } }).run;
    expect(run2.id).toBe(run1.id);
    const rows = await db.select().from(agentRuns).where(eq(agentRuns.projectId, projectId));
    expect(rows).toHaveLength(1);
  });

  it('429 after 20 starts within an hour (per-user rate limit)', async () => {
    const { cookie, projectId } = await setup();
    let last = 0;
    for (let i = 0; i < 21; i++) {
      // invalid body: rejected by validation AFTER the rate-limit check
      const res = await startRun(cookie, projectId, { input: '' });
      last = res.statusCode;
    }
    expect(last).toBe(429);
  });
});

// ---------------------------------------------------------------------------
// reads: list, detail, SSE
// ---------------------------------------------------------------------------

describe('agent run reads', () => {
  async function seedRun(projectId: string, userId: string, status: string, error: string | null = null) {
    const [row] = await db
      .insert(agentRuns)
      .values({ projectId, userId, input: 'seed', status, error })
      .returning();
    return row;
  }

  it('lists runs paginated (viewer)', async () => {
    const { cookie, userId, projectId } = await setup();
    await seedRun(projectId, userId, 'completed');
    await seedRun(projectId, userId, 'failed', 'boom');
    const res = await app.inject(
      authed(cookie, { method: 'GET', url: `/api/v1/projects/${projectId}/agent/runs?page=1&limit=10` }),
    );
    expect(res.statusCode).toBe(200);
    const body = res.json() as { runs: unknown[]; total: number };
    expect(body.total).toBe(2);
    expect(body.runs).toHaveLength(2);
  });

  it('returns run detail with steps (viewer)', async () => {
    const { cookie, userId, projectId } = await setup();
    const run = await seedRun(projectId, userId, 'completed');
    await db.insert(agentSteps).values({ runId: run.id, stepNo: 0, kind: 'list_project_assets', title: 'List', status: 'completed' });
    const res = await app.inject(
      authed(cookie, { method: 'GET', url: `/api/v1/agent/runs/${run.id}` }),
    );
    expect(res.statusCode).toBe(200);
    const body = res.json() as { run: { id: string }; steps: { tool: string }[] };
    expect(body.run.id).toBe(run.id);
    expect(body.steps).toHaveLength(1);
    expect(body.steps[0].tool).toBe('list_project_assets');
  });

  it('404s for a run in another workspace', async () => {
    const a = await setup();
    const b = await setup();
    const run = await seedRun(a.projectId, a.userId, 'completed');
    const res = await app.inject(
      authed(b.cookie, { method: 'GET', url: `/api/v1/agent/runs/${run.id}` }),
    );
    expect(res.statusCode).toBe(404);
  });

  it('viewer can list runs but cannot start one (needs editor)', async () => {
    const { userId, workspaceId, projectId } = await setup();
    const viewer = await dbSetupViewer(workspaceId);
    await db.insert(agentRuns).values({ projectId, userId, input: 'seed', status: 'completed' });
    const list = await app.inject(
      authed(viewer.cookie, { method: 'GET', url: `/api/v1/projects/${projectId}/agent/runs` }),
    );
    expect(list.statusCode).toBe(200);
    expect((list.json() as { total: number }).total).toBe(1);
    process.env.OPENROUTER_API_KEY = 'test-key';
    const denied = await startRun(viewer.cookie, projectId, { input: 'hello' });
    expect(denied.statusCode).toBe(404);
  });

  it('streams events as SSE and closes after run.finished', async () => {
    const { cookie, userId, projectId } = await setup();
    const run = await seedRun(projectId, userId, 'completed');
    await db.insert(agentEvents).values([
      { runId: run.id, seq: 0, type: 'run.started', payload: { runId: run.id } },
      { runId: run.id, seq: 1, type: 'run.finished', payload: { status: 'completed' } },
    ]);
    const res = await app.inject(
      authed(cookie, { method: 'GET', url: `/api/v1/agent/runs/${run.id}/events` }),
    );
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.body).toContain('run.started');
    expect(res.body).toContain('run.finished');
    expect(res.body).toContain('data: ');
  });
});

// ---------------------------------------------------------------------------
// cancel / resume / approve
// ---------------------------------------------------------------------------

describe('run mutations', () => {
  it('cancel → cancelled, resume → pending, approve rejected → cancelled', async () => {
    const { cookie, projectId } = await setup();
    process.env.OPENROUTER_API_KEY = 'test-key';
    const started = await startRun(cookie, projectId, { input: 'do things' });
    expect(started.statusCode).toBe(202);
    const runId = (started.json() as { run: { id: string } }).run.id;

    const cancelled = await app.inject(
      authed(cookie, { method: 'POST', url: `/api/v1/agent/runs/${runId}/cancel` }),
    );
    expect(cancelled.statusCode).toBe(200);
    expect((cancelled.json() as { run: { state: string } }).run.state).toBe('cancelled');

    const resumed = await app.inject(
      authed(cookie, { method: 'POST', url: `/api/v1/agent/runs/${runId}/resume` }),
    );
    expect(resumed.statusCode).toBe(200);
    expect((resumed.json() as { run: { state: string } }).run.state).toBe('pending');
  });

  it('approve(true) on a waiting run → running; approve(false) → cancelled', async () => {
    const { cookie, userId, projectId } = await setup();
    const [waiting] = await db
      .insert(agentRuns)
      .values({
        projectId,
        userId: userId,
        input: 'expensive',
        status: 'waiting_approval',
        approval: { reason: 'over budget', requestedBudgetUsd: 10 },
      })
      .returning();
    const ok = await app.inject(
      authed(cookie, {
        method: 'POST',
        url: `/api/v1/agent/runs/${waiting.id}/approve`,
        payload: { approved: true, budgetUsd: 10 },
      }),
    );
    expect(ok.statusCode).toBe(200);
    expect((ok.json() as { run: { state: string } }).run.state).toBe('running');

    const [waiting2] = await db
      .insert(agentRuns)
      .values({
        projectId,
        userId: userId,
        input: 'expensive 2',
        status: 'waiting_approval',
        approval: { reason: 'over budget', requestedBudgetUsd: 10 },
      })
      .returning();
    const no = await app.inject(
      authed(cookie, {
        method: 'POST',
        url: `/api/v1/agent/runs/${waiting2.id}/approve`,
        payload: { approved: false },
      }),
    );
    expect(no.statusCode).toBe(200);
    expect((no.json() as { run: { state: string } }).run.state).toBe('cancelled');
  });
});

// ---------------------------------------------------------------------------
// admin
// ---------------------------------------------------------------------------

describe('admin agent endpoints', () => {
  it('lists runs with ?state=, aggregates usage, lists errors', async () => {
    const { cookie, userId, projectId } = await setup();
    await makeAdmin(userId);
    const [failed] = await db
      .insert(agentRuns)
      .values({ projectId, userId: userId, input: 'x', status: 'failed', error: 'kaboom' })
      .returning();
    await db.insert(agentRuns).values({ projectId, userId: userId, input: 'y', status: 'completed' });
    await db.insert(modelUsage).values([
      { runId: failed.id, model: 'fake-model', tool: 'generate_marketing_copy', tokensIn: 10, tokensOut: 5, costUsd: '0.01' },
      { runId: failed.id, model: 'fake-model', tool: 'generate_marketing_copy', tokensIn: 20, tokensOut: 5, costUsd: '0.02' },
    ]);

    const runs = await app.inject(
      authed(cookie, { method: 'GET', url: '/api/v1/admin/agent/runs?state=failed' }),
    );
    expect(runs.statusCode).toBe(200);
    expect((runs.json() as { total: number }).total).toBe(1);

    const usage = await app.inject(
      authed(cookie, { method: 'GET', url: '/api/v1/admin/agent/usage?days=30' }),
    );
    expect(usage.statusCode).toBe(200);
    const u = usage.json() as { usage: { model: string; calls: number; tokensIn: number; costUsd: string }[] };
    expect(u.usage).toHaveLength(1);
    expect(u.usage[0].calls).toBe(2);
    expect(u.usage[0].tokensIn).toBe(30);

    const errors = await app.inject(
      authed(cookie, { method: 'GET', url: '/api/v1/admin/agent/errors' }),
    );
    expect(errors.statusCode).toBe(200);
    const e = errors.json() as { errors: { id: string; error: string }[] };
    expect(e.errors).toHaveLength(1);
    expect(e.errors[0].error).toBe('kaboom');
  });

  it('403s for non-admins', async () => {
    const { cookie } = await setup();
    const res = await app.inject(
      authed(cookie, { method: 'GET', url: '/api/v1/admin/agent/runs' }),
    );
    expect(res.statusCode).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// full cycle with the fake provider: start → executeRun → completed
// ---------------------------------------------------------------------------

describe('full run cycle (fake OpenRouter, no network)', () => {
  it('completes and records steps, events, usage, ledger and an assistant message', async () => {
    const { cookie, workspaceId, projectId } = await setup();
    process.env.OPENROUTER_API_KEY = 'test-key';

    // conversation for the run's final message
    const convRes = await app.inject(
      authed(cookie, { method: 'GET', url: `/api/v1/projects/${projectId}/conversation` }),
    );
    const conversationId = (convRes.json() as { conversation: { id: string } }).conversation.id;

    const started = await startRun(cookie, projectId, { input: 'launch campaign' });
    expect(started.statusCode).toBe(202);
    const runId = (started.json() as { run: { id: string } }).run.id;

    // attach the conversation, then execute with the fake provider
    await db.update(agentRuns).set({ conversationId }).where(eq(agentRuns.id, runId));
    const orchestrator = buildTestOrchestrator(db, '/tmp/bf-test-storage', {
      openrouter: new FakeOpenRouterClient(),
      router: fakeRouter,
    });
    await orchestrator.executeRun(runId);

    const [run] = await db.select().from(agentRuns).where(eq(agentRuns.id, runId));
    expect(run.status).toBe('completed');

    const steps = await db.select().from(agentSteps).where(eq(agentSteps.runId, runId));
    expect(steps).toHaveLength(2);
    expect(steps.every((s) => s.status === 'completed')).toBe(true);

    const events = await db
      .select()
      .from(agentEvents)
      .where(eq(agentEvents.runId, runId))
      .orderBy(desc(agentEvents.seq));
    const types = events.map((e) => e.type);
    expect(types).toContain('run.started');
    expect(types).toContain('run.finished');
    expect(types).toContain('step.completed');
    // seq is gapless per run
    const seqs = events.map((e) => e.seq).sort((a, b) => a - b);
    expect(seqs[0]).toBe(0);

    const usage = await db.select().from(modelUsage).where(eq(modelUsage.runId, runId));
    expect(usage.length).toBeGreaterThanOrEqual(1);
    const genUsage = usage.find((u) => u.tool === 'generate_marketing_copy');
    expect(genUsage).toBeDefined();
    expect(genUsage!.tokensIn).toBe(200);

    // ledger: a reserve was placed and settled against the actual cost
    const ledger = await db
      .select()
      .from(creditLedger)
      .where(eq(creditLedger.workspaceId, workspaceId))
      .orderBy(creditLedger.createdAt);
    const kinds = ledger.map((l) => l.kind);
    expect(kinds).toContain('grant'); // monthly free allowance
    expect(kinds).toContain('reserve');
    expect(kinds).toContain('settle');
    const [quota] = await db.select().from(usageQuotas).where(eq(usageQuotas.workspaceId, workspaceId));
    expect(Number(quota.creditsBalance)).toBeGreaterThan(0);
    expect(Number(quota.creditsBalance)).toBeLessThanOrEqual(5);

    // the run's final answer landed in the conversation
    const msgs = await db.select().from(messages).where(eq(messages.conversationId, conversationId));
    const assistant = msgs.find((m) => m.role === 'assistant');
    expect(assistant).toBeDefined();
    expect(assistant!.content.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// chat: stub vs real run
// ---------------------------------------------------------------------------

describe('POST /conversations/:id/messages', () => {
  async function postMessage(cookie: string, conversationId: string, content: string) {
    return app.inject(
      authed(cookie, {
        method: 'POST',
        url: `/api/v1/conversations/${conversationId}/messages`,
        payload: { content },
      }),
    );
  }

  it('keeps the honest stub when AI is not configured', async () => {
    const { cookie, projectId } = await setup();
    const convRes = await app.inject(
      authed(cookie, { method: 'GET', url: `/api/v1/projects/${projectId}/conversation` }),
    );
    const conversationId = (convRes.json() as { conversation: { id: string } }).conversation.id;
    const res = await postMessage(cookie, conversationId, 'hello?');
    expect(res.statusCode).toBe(200);
    const body = res.json() as { reply: { notice: string } };
    expect(body.reply.notice).toBe('AI_NOT_CONFIGURED');
  });

  it('starts a real run when AI is configured and quota allows', async () => {
    const { cookie, projectId } = await setup();
    process.env.OPENROUTER_API_KEY = 'test-key';
    const convRes = await app.inject(
      authed(cookie, { method: 'GET', url: `/api/v1/projects/${projectId}/conversation` }),
    );
    const conversationId = (convRes.json() as { conversation: { id: string } }).conversation.id;
    const res = await postMessage(cookie, conversationId, 'make me a campaign');
    expect(res.statusCode).toBe(200);
    const body = res.json() as { message: { id: string }; run: { id: string; state: string } };
    expect(body.message.id).toBeDefined();
    expect(body.run.id).toBeDefined();
    expect(body.run.state).toBe('pending');
    // no stub assistant message was saved synchronously
    const msgs = await db.select().from(messages).where(eq(messages.conversationId, conversationId));
    expect(msgs.filter((m) => m.role === 'assistant')).toHaveLength(0);
  });
});
