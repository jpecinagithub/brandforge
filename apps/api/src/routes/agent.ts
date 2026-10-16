/**
 * Agent run routes.
 *
 * POST   /api/v1/campaigns/:campaignId/agent/runs      start a run (editor, 20/h per user)
 * GET    /api/v1/campaigns/:campaignId/agent/runs      list runs (viewer, paginated)
 * GET    /api/v1/agent/runs/:runId                     run detail + steps (viewer)
 * POST   /api/v1/agent/runs/:runId/cancel              (editor)
 * POST   /api/v1/agent/runs/:runId/resume              (editor)
 * POST   /api/v1/agent/runs/:runId/approve             (editor)
 * GET    /api/v1/agent/runs/:runId/events              SSE tail of agent_events (viewer)
 *
 * HTTP handlers only mutate rows / delegate to the orchestrator — they never
 * run the agent loop (ADR-0006). The worker executes claimed runs.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { count, desc, eq, gt, sql } from 'drizzle-orm';
import {
  agentEvents,
  agentRuns,
  agentSteps,
  modelUsage,
  type Db,
} from '@brandforge/database';
import {
  AgentPlanSchema,
  ApproveRunInputSchema,
  PaginationQuerySchema,
  RunStateSchema,
  StartRunInputSchema,
  type AgentEvent,
  type AgentRun,
  type AgentStep,
  type ModelUsageSummary,
  type RunState,
} from '@brandforge/shared';
import {
  approveAgentRun,
  cancelAgentRun,
  checkAiAllowed,
  ensureWorkspaceQuota,
  incrementGenerations,
  isAiConfigured,
  listEventsAfter,
  resumeAgentRun,
  startAgentRun,
} from '@brandforge/agent-server';
import { getDb } from '../db.js';
import { Errors, sendError, zodDetails } from '../errors.js';
import { audit, requestMeta } from '../authz.js';
import { projectGuard } from './projects.js';
import { config } from '../config.js';

type Authed = FastifyRequest & { user: NonNullable<FastifyRequest['user']> };

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export function toAgentRunDto(r: typeof agentRuns.$inferSelect): AgentRun {
  const state = RunStateSchema.safeParse(r.status);
  const plan = AgentPlanSchema.safeParse(r.plan);
  return {
    id: r.id,
    campaignId: r.projectId,
    conversationId: r.conversationId,
    state: (state.success ? state.data : r.status) as RunState,
    input: r.input,
    plan: plan.success ? plan.data : null,
    completedSteps: r.completedSteps,
    totalSteps: r.totalSteps,
    costUsd: r.costUsd,
    error: r.error,
    approval: (r.approval ?? null) as AgentRun['approval'],
    createdAt: r.createdAt.toISOString(),
    updatedAt: (r.updatedAt ?? r.createdAt).toISOString(),
  };
}

function toAgentStepDto(s: typeof agentSteps.$inferSelect): AgentStep {
  const detail = s.detail && typeof s.detail === 'object'
    ? s.detail as Record<string, unknown>
    : {};
  return {
    id: s.id,
    planStepId: typeof detail.planStepId === 'string' ? detail.planStepId : undefined,
    stepNo: s.stepNo,
    title: s.title,
    tool: s.kind,
    state: s.status,
    error: s.error,
  };
}

function toAgentEventDto(e: typeof agentEvents.$inferSelect): AgentEvent {
  return {
    id: e.id,
    runId: e.runId,
    seq: e.seq,
    type: e.type as AgentEvent['type'],
    payload: (e.payload ?? {}) as Record<string, unknown>,
    createdAt: e.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// per-user rate limit (20/h on run creation) — in-process sliding window
// ---------------------------------------------------------------------------

const rateBuckets = new Map<string, number[]>();

function userRateLimitOk(userId: string, key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const k = `${userId}:${key}`;
  const recent = (rateBuckets.get(k) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= max) {
    rateBuckets.set(k, recent);
    return false;
  }
  recent.push(now);
  rateBuckets.set(k, recent);
  return true;
}

// ---------------------------------------------------------------------------
// quota helpers
// ---------------------------------------------------------------------------

const TERMINAL_STATES: ReadonlySet<string> = new Set(['completed', 'failed', 'cancelled']);

async function loadRunForUser(
  db: Db,
  request: FastifyRequest,
  reply: Parameters<typeof projectGuard>[2],
  runId: string,
  minRole: 'viewer' | 'editor',
) {
  const [run] = await db.select().from(agentRuns).where(eq(agentRuns.id, runId)).limit(1);
  if (!run) {
    await Errors.notFound(reply);
    return null;
  }
  const p = await projectGuard(db, request, reply, run.projectId, minRole);
  if (!p) return null;
  return { run, project: p };
}

export async function agentRoutes(app: FastifyInstance): Promise<void> {
  const db: Db = getDb();

  // ---- start run
  const startRun = async (request: FastifyRequest, reply: FastifyReply) => {
      const req = request as Authed;
      if (!userRateLimitOk(req.user.rawId, 'agent.start', 20, 3_600_000)) {
        return sendError(reply, 429, 'RATE_LIMITED', 'Too many agent runs started (20/hour)');
      }
      const params = request.params as { projectId?: string; campaignId?: string };
      const projectId = params.campaignId ?? params.projectId ?? '';
      const p = await projectGuard(db, request, reply, projectId, 'editor');
      if (!p) return;
      const parsed = StartRunInputSchema.safeParse(request.body);
      if (!parsed.success) return Errors.validation(reply, 'Invalid input', zodDetails(parsed.error));

      if (!isAiConfigured()) {
        return sendError(reply, 503, 'AI_NOT_CONFIGURED', 'OpenRouter is not configured on this server');
      }
      await ensureWorkspaceQuota(db, p.workspaceId);
      const allowed = await checkAiAllowed(db, p.workspaceId);
      if (!allowed.ok) {
        const status = allowed.reason === 'INSUFFICIENT_CREDITS' ? 402 : 403;
        return sendError(reply, status, 'QUOTA_EXCEEDED', `AI quota exceeded: ${allowed.reason}`);
      }

      let started: { id: string; state: string; deduped: boolean };
      try {
        started = await startAgentRun(db, config.storagePath, {
          userId: req.user.rawId,
          workspaceId: p.workspaceId,
          projectId,
          input: parsed.data.input,
          language: parsed.data.language ?? (req.user.language === 'es' ? 'es' : 'en'),
          idempotencyKey: parsed.data.idempotencyKey,
          maxSteps: parsed.data.maxSteps,
          budgetUsd: parsed.data.budgetUsd,
        });
      } catch (err) {
        // Idempotency fallback: the orchestrator owns the unique key; if it
        // raced, return the existing run instead of a 500.
        if (parsed.data.idempotencyKey) {
          const [existing] = await db
            .select()
            .from(agentRuns)
            .where(eq(agentRuns.idempotencyKey, parsed.data.idempotencyKey))
            .limit(1);
          if (existing) {
            return reply.code(202).send({ run: toAgentRunDto(existing) });
          }
        }
        throw err;
      }
      const { ip, userAgent } = requestMeta(request);
      // Count the run against the monthly quota — once per logical run
      // (idempotent replays don't double-count).
      if (!started.deduped) await incrementGenerations(db, p.workspaceId);
      await audit(db, {
        userId: req.user.rawId,
        action: 'agent.run.start',
        ip,
        userAgent,
        meta: { runId: started.id, projectId },
      });
      const [row] = await db.select().from(agentRuns).where(eq(agentRuns.id, started.id)).limit(1);
      return reply.code(202).send({ run: toAgentRunDto(row) });
  };
  app.post('/api/v1/campaigns/:campaignId/agent/runs', { preHandler: [app.authenticate] }, startRun);
  app.post('/api/v1/projects/:projectId/agent/runs', { preHandler: [app.authenticate] }, startRun);

  // ---- list runs
  const listRuns = async (request: FastifyRequest, reply: FastifyReply) => {
      const params = request.params as { projectId?: string; campaignId?: string };
      const projectId = params.campaignId ?? params.projectId ?? '';
      const p = await projectGuard(db, request, reply, projectId, 'viewer');
      if (!p) return;
      const pg = PaginationQuerySchema.safeParse(request.query);
      if (!pg.success) return Errors.validation(reply, 'Invalid input', zodDetails(pg.error));
      const [total] = await db
        .select({ n: count() })
        .from(agentRuns)
        .where(eq(agentRuns.projectId, projectId));
      const rows = await db
        .select()
        .from(agentRuns)
        .where(eq(agentRuns.projectId, projectId))
        .orderBy(desc(agentRuns.createdAt))
        .limit(pg.data.limit)
        .offset((pg.data.page - 1) * pg.data.limit);
      return {
        runs: rows.map(toAgentRunDto),
        total: total.n,
        page: pg.data.page,
        limit: pg.data.limit,
      };
  };
  app.get('/api/v1/campaigns/:campaignId/agent/runs', { preHandler: [app.authenticate] }, listRuns);
  app.get('/api/v1/projects/:projectId/agent/runs', { preHandler: [app.authenticate] }, listRuns);

  // ---- run detail + steps
  app.get('/api/v1/agent/runs/:runId', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { runId } = request.params as { runId: string };
    const found = await loadRunForUser(db, request, reply, runId, 'viewer');
    if (!found) return;
    const steps = await db
      .select()
      .from(agentSteps)
      .where(eq(agentSteps.runId, runId))
      .orderBy(agentSteps.stepNo);
    return { run: toAgentRunDto(found.run), steps: steps.map(toAgentStepDto) };
  });

  // ---- cancel / resume / approve
  const mutate = (
    url: string,
    action: string,
    fn: (runId: string, body?: { approved: boolean; budgetUsd?: number }) => Promise<void>,
    needsBody: boolean,
  ) => {
    app.post(url, { preHandler: [app.authenticate] }, async (request, reply) => {
      const req = request as Authed;
      const { runId } = request.params as { runId: string };
      const found = await loadRunForUser(db, request, reply, runId, 'editor');
      if (!found) return;
      let body: { approved: boolean; budgetUsd?: number } | undefined;
      if (needsBody) {
        const parsed = ApproveRunInputSchema.safeParse(request.body);
        if (!parsed.success) return Errors.validation(reply, 'Invalid input', zodDetails(parsed.error));
        body = parsed.data;
      }
      await fn(runId, body);
      const { ip, userAgent } = requestMeta(request);
      await audit(db, { userId: req.user.rawId, action, ip, userAgent, meta: { runId } });
      const [row] = await db.select().from(agentRuns).where(eq(agentRuns.id, runId)).limit(1);
      return { run: toAgentRunDto(row) };
    });
  };

  mutate('/api/v1/agent/runs/:runId/cancel', 'agent.run.cancel', (runId) =>
    cancelAgentRun(db, config.storagePath, runId),
    false,
  );
  mutate('/api/v1/agent/runs/:runId/resume', 'agent.run.resume', (runId) =>
    resumeAgentRun(db, config.storagePath, runId),
    false,
  );
  mutate(
    '/api/v1/agent/runs/:runId/approve',
    'agent.run.approve',
    (runId, body) => approveAgentRun(db, config.storagePath, runId, body!.approved, body!.budgetUsd),
    true,
  );

  // ---- SSE: tail agent_events
  app.get(
    '/api/v1/agent/runs/:runId/events',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { runId } = request.params as { runId: string };
      const found = await loadRunForUser(db, request, reply, runId, 'viewer');
      if (!found) return;
      const rawQueryAfter = (request.query as { after?: string }).after;
      const queryAfter = rawQueryAfter === undefined ? null : Number(rawQueryAfter);
      const headerAfter = Number(request.headers['last-event-id'] ?? -1);

      reply.hijack();
      const raw = reply.raw;
      raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      raw.write(': connected\n\n');

      let lastSeq = queryAfter !== null && Number.isInteger(queryAfter) && queryAfter >= -1
        ? queryAfter
        : Number.isInteger(headerAfter) && headerAfter >= -1
          ? headerAfter
          : -1;
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(pollTimer);
        clearInterval(pingTimer);
        try {
          raw.end();
        } catch {
          // client already gone
        }
      };
      request.raw.on('close', close);

      const flush = async (): Promise<boolean> => {
        // returns true when the stream should close
        const events = await listEventsAfter(db, runId, lastSeq);
        for (const e of events) {
          if (closed) return true;
          lastSeq = Math.max(lastSeq, e.seq);
          raw.write(`id: ${e.seq}\ndata: ${JSON.stringify(toAgentEventDto(e))}\n\n`);
          if (e.type === 'run.finished') return true;
        }
        const [run] = await db.select({ status: agentRuns.status }).from(agentRuns).where(eq(agentRuns.id, runId)).limit(1);
        if (!run || TERMINAL_STATES.has(run.status)) return true;
        return false;
      };

      const pollTimer = setInterval(() => {
        flush()
          .then((done) => {
            if (done) close();
          })
          .catch(() => close());
      }, 800);
      const pingTimer = setInterval(() => {
        if (!closed) raw.write(': ping\n\n');
      }, 15_000);

      try {
        if (await flush()) close();
      } catch {
        close();
      }
    },
  );
}

/** Admin: aggregate model usage per model over the last `days` days. */
export async function modelUsageSummary(
  db: Db,
  days: number,
): Promise<ModelUsageSummary[]> {
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await db
    .select({
      model: modelUsage.model,
      calls: count(),
      tokensIn: sql<number>`coalesce(sum(${modelUsage.tokensIn}), 0)`,
      tokensOut: sql<number>`coalesce(sum(${modelUsage.tokensOut}), 0)`,
      costUsd: sql<string | null>`sum(${modelUsage.costUsd})`,
    })
    .from(modelUsage)
    .where(gt(modelUsage.createdAt, since))
    .groupBy(modelUsage.model)
    .orderBy(desc(sql`sum(${modelUsage.costUsd})`));
  return rows.map((r) => ({
    model: r.model,
    calls: r.calls,
    tokensIn: Number(r.tokensIn),
    tokensOut: Number(r.tokensOut),
    costUsd: r.costUsd,
  }));
}
