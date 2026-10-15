/** Admin routes: /api/v1/admin/* — requires user.is_admin. */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { and, count, desc, eq, gt, ilike, isNull, or } from 'drizzle-orm';
import {
  agentRuns,
  auditLogs,
  campaigns,
  projects,
  sessions,
  users,
  type Db,
} from '@brandforge/database';
import { PaginationQuerySchema, SetAdminInputSchema } from '@brandforge/shared';
import { getDb } from '../db.js';
import { Errors, sendError, zodDetails } from '../errors.js';
import { audit, requestMeta, toUserPublic } from '../authz.js';
import { modelUsageSummary, toAgentRunDto } from './agent.js';

type Authed = FastifyRequest & { user: NonNullable<FastifyRequest['user']> };

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  const db: Db = getDb();
  const prefix = '/api/v1/admin';
  const guard = { preHandler: [app.authenticate, app.requireAdmin] };

  app.get(`${prefix}/overview`, guard, async () => {
    const dayAgo = new Date(Date.now() - 86_400_000);
    const [[u], [pa], [pb], [d], [pr], [c], [r], [e]] = await Promise.all([
      db.select({ n: count() }).from(users),
      db.select({ n: count() }).from(users).where(eq(users.status, 'active')),
      db.select({ n: count() }).from(users).where(eq(users.status, 'blocked')),
      db.select({ n: count() }).from(users).where(and(eq(users.isDemo, true), gt(users.demoExpiresAt, new Date()))),
      db.select({ n: count() }).from(projects),
      db.select({ n: count() }).from(campaigns),
      db.select({ n: count() }).from(agentRuns),
      db.select({ n: count() }).from(auditLogs).where(and(eq(auditLogs.action, 'error'), gt(auditLogs.createdAt, dayAgo))),
    ]);
    return {
      usersTotal: u.n,
      usersActive: pa.n,
      usersBlocked: pb.n,
      demoActive: d.n,
      projectsTotal: pr.n,
      campaignsTotal: c.n,
      agentRunsTotal: r.n,
      errorsLast24h: e.n,
    };
  });

  app.get(`${prefix}/users`, guard, async (request, reply) => {
    const q = request.query as { page?: string; limit?: string; search?: string };
    const pg = PaginationQuerySchema.safeParse(q);
    if (!pg.success) return Errors.validation(reply, 'Invalid input', zodDetails(pg.error));
    const where = q.search
      ? or(ilike(users.email, `%${q.search}%`), ilike(users.name, `%${q.search}%`))
      : undefined;
    const [total] = await db.select({ n: count() }).from(users).where(where);
    const rows = await db
      .select()
      .from(users)
      .where(where)
      .orderBy(desc(users.createdAt))
      .limit(pg.data.limit)
      .offset((pg.data.page - 1) * pg.data.limit);
    return {
      users: rows.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        status: u.status,
        isAdmin: u.isAdmin,
        isDemo: u.isDemo,
        createdAt: u.createdAt.toISOString(),
      })),
      total: total.n,
      page: pg.data.page,
      limit: pg.data.limit,
    };
  });

  const setStatus = async (request: FastifyRequest, reply: FastifyReply, status: 'active' | 'blocked') => {
    const req = request as Authed;
    const { id } = request.params as { id: string };
    if (id === req.user.rawId) return sendError(reply, 400, 'BAD_REQUEST', 'You cannot change your own status');
    const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    if (!user) return Errors.notFound(reply);
    const [updated] = await db.update(users).set({ status, updatedAt: new Date() }).where(eq(users.id, id)).returning();
    if (status === 'blocked') {
      await db.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.userId, id), isNull(sessions.revokedAt)));
    }
    const { ip, userAgent } = requestMeta(request);
    await audit(db, { userId: req.user.rawId, action: `admin.user.${status}`, ip, userAgent, meta: { targetUserId: id } });
    return { user: toUserPublic(updated) };
  };

  app.post(`${prefix}/users/:id/block`, guard, (request, reply) => setStatus(request, reply, 'blocked'));
  app.post(`${prefix}/users/:id/unblock`, guard, (request, reply) => setStatus(request, reply, 'active'));

  app.patch(`${prefix}/users/:id/admin`, guard, async (request, reply) => {
    const req = request as Authed;
    const { id } = request.params as { id: string };
    const parsed = SetAdminInputSchema.safeParse(request.body);
    if (!parsed.success) return Errors.validation(reply, 'Invalid input', zodDetails(parsed.error));
    if (id === req.user.rawId && !parsed.data.isAdmin) {
      return sendError(reply, 400, 'BAD_REQUEST', 'You cannot remove your own admin role');
    }
    const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    if (!user) return Errors.notFound(reply);
    const [updated] = await db
      .update(users)
      .set({ isAdmin: parsed.data.isAdmin, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    const { ip, userAgent } = requestMeta(request);
    await audit(db, { userId: req.user.rawId, action: 'admin.user.set_admin', ip, userAgent, meta: { targetUserId: id, isAdmin: parsed.data.isAdmin } });
    return { user: toUserPublic(updated) };
  });

  app.get(`${prefix}/audit-logs`, guard, async (request) => {
    const q = request.query as { limit?: string };
    const limit = Math.min(Math.max(Number.parseInt(q.limit ?? '50', 10) || 50, 1), 200);
    const rows = await db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(limit);
    return {
      logs: rows.map((l) => ({
        id: l.id,
        userId: l.userId,
        action: l.action,
        ip: l.ip,
        userAgent: l.userAgent,
        meta: l.meta,
        createdAt: l.createdAt.toISOString(),
      })),
    };
  });

  // ---- Agent observability (never exposes provider keys)

  app.get(`${prefix}/agent/runs`, guard, async (request, reply) => {
    const q = request.query as { page?: string; limit?: string; state?: string };
    const pg = PaginationQuerySchema.safeParse({ page: q.page, limit: q.limit });
    if (!pg.success) return Errors.validation(reply, 'Invalid input', zodDetails(pg.error));
    const where = q.state ? eq(agentRuns.status, q.state) : undefined;
    const [total] = await db.select({ n: count() }).from(agentRuns).where(where);
    const rows = await db
      .select()
      .from(agentRuns)
      .where(where)
      .orderBy(desc(agentRuns.createdAt))
      .limit(pg.data.limit)
      .offset((pg.data.page - 1) * pg.data.limit);
    return {
      runs: rows.map(toAgentRunDto),
      total: total.n,
      page: pg.data.page,
      limit: pg.data.limit,
    };
  });

  app.get(`${prefix}/agent/usage`, guard, async (request) => {
    const q = request.query as { days?: string };
    const days = Math.min(Math.max(Number.parseInt(q.days ?? '30', 10) || 30, 1), 365);
    return { days, usage: await modelUsageSummary(db, days) };
  });

  app.get(`${prefix}/agent/errors`, guard, async () => {
    const rows = await db
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.status, 'failed'))
      .orderBy(desc(agentRuns.createdAt))
      .limit(20);
    return {
      errors: rows.map((r) => ({
        id: r.id,
        projectId: r.projectId,
        userId: r.userId,
        error: r.error,
        attempts: r.attempts,
        createdAt: r.createdAt.toISOString(),
        finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
      })),
    };
  });
}
