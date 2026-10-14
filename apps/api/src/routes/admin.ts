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
}
