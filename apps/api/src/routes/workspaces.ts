/**
 * Workspace routes: /api/v1/workspaces*
 * Membership-gated: non-members get 404 (never 403) to avoid leaking existence.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import { workspaceMembers, workspaces, type Db } from '@brandforge/database';
import { CreateWorkspaceInputSchema, type WorkspaceRole } from '@brandforge/shared';
import { getDb } from '../db.js';
import { Errors, zodDetails } from '../errors.js';
import { audit, getMembership, requestMeta } from '../authz.js';

type Authed = FastifyRequest & { user: NonNullable<FastifyRequest['user']> };

export async function workspaceRoutes(app: FastifyInstance): Promise<void> {
  const db: Db = getDb();
  const prefix = '/api/v1/workspaces';

  app.get(prefix, { preHandler: [app.authenticate] }, async (request) => {
    const req = request as Authed;
    const rows = await db
      .select({ ws: workspaces, role: workspaceMembers.role })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
      .where(eq(workspaceMembers.userId, req.user.rawId));
    return {
      workspaces: rows.map((r) => ({
        id: r.ws.id,
        name: r.ws.name,
        isDemo: r.ws.isDemo,
        role: r.role as WorkspaceRole,
      })),
    };
  });

  app.post(prefix, { preHandler: [app.authenticate] }, async (request, reply) => {
    const req = request as Authed;
    const parsed = CreateWorkspaceInputSchema.safeParse(request.body);
    if (!parsed.success) return Errors.validation(reply, 'Invalid input', zodDetails(parsed.error));
    const [ws] = await db.insert(workspaces).values({ name: parsed.data.name }).returning();
    await db.insert(workspaceMembers).values({ workspaceId: ws.id, userId: req.user.rawId, role: 'owner' });
    const { ip, userAgent } = requestMeta(request);
    await audit(db, { userId: req.user.rawId, action: 'workspace.create', ip, userAgent, meta: { workspaceId: ws.id } });
    return reply.code(201).send({
      workspace: { id: ws.id, name: ws.name, isDemo: ws.isDemo, role: 'owner' as const },
    });
  });

  app.get(`${prefix}/:id`, { preHandler: [app.authenticate] }, async (request, reply) => {
    const req = request as Authed;
    const { id } = request.params as { id: string };
    const role = await getMembership(db, req.user.rawId, id);
    if (!role) return Errors.notFound(reply);
    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, id)).limit(1);
    if (!ws) return Errors.notFound(reply);
    return { workspace: { id: ws.id, name: ws.name, isDemo: ws.isDemo, role } };
  });
}
