/**
 * Project routes: /api/v1/projects*
 * Campaigns, brand kits, conversation and assets for a project live in their
 * own route files; project-scoped authz helpers live here.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { count, eq } from 'drizzle-orm';
import { campaigns, projects, type Db, type Project } from '@brandforge/database';
import {
  CreateProjectInputSchema,
  FavoriteProjectInputSchema,
  UpdateProjectInputSchema,
  type WorkspaceRole,
} from '@brandforge/shared';
import { getDb } from '../db.js';
import { Errors, isUuid, sendError, zodDetails } from '../errors.js';
import { audit, getMembership, requestMeta, requireWorkspaceRole, roleAtLeast } from '../authz.js';

type Authed = FastifyRequest & { user: NonNullable<FastifyRequest['user']> };

export async function campaignCountFor(db: Db, projectId: string): Promise<number> {
  const rows = await db.select({ n: count() }).from(campaigns).where(eq(campaigns.projectId, projectId));
  return rows[0]?.n ?? 0;
}

export function toProjectApi(p: Project, campaignCount: number) {
  return {
    id: p.id,
    workspaceId: p.workspaceId,
    name: p.name,
    description: p.description,
    isFavorite: p.isFavorite,
    updatedAt: p.updatedAt ? p.updatedAt.toISOString() : p.createdAt.toISOString(),
    campaignCount,
  };
}

/** Resolve a project + enforce min role on its workspace. 404 when missing/not member. */
export async function projectGuard(
  db: Db,
  request: FastifyRequest,
  reply: FastifyReply,
  projectId: string,
  minRole: WorkspaceRole,
): Promise<Project | null> {
  const req = request as Authed;
  const [p] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!p) {
    await Errors.notFound(reply);
    return null;
  }
  const role = await getMembership(db, req.user.rawId, p.workspaceId);
  if (!roleAtLeast(role, minRole)) {
    await Errors.notFound(reply);
    return null;
  }
  return p;
}

export async function projectRoutes(app: FastifyInstance): Promise<void> {
  const db: Db = getDb();
  const prefix = '/api/v1/projects';

  // ---- list (workspace-scoped)
  app.get(prefix, { preHandler: [app.authenticate] }, async (request, reply) => {
    const req = request as Authed;
    const { workspaceId } = request.query as { workspaceId?: string };
    if (!workspaceId) return sendError(reply, 400, 'BAD_REQUEST', 'workspaceId query param is required');
    if (!isUuid(workspaceId)) return sendError(reply, 400, 'BAD_REQUEST', 'workspaceId must be a valid UUID');
    const role = await getMembership(db, req.user.rawId, workspaceId);
    if (!role) return Errors.notFound(reply);
    const rows = await db.select().from(projects).where(eq(projects.workspaceId, workspaceId));
    const out = [];
    for (const p of rows) out.push(toProjectApi(p, await campaignCountFor(db, p.id)));
    return { projects: out };
  });

  // ---- create
  app.post(
    prefix,
    { preHandler: [app.authenticate, requireWorkspaceRole(db, 'editor', (r) => (r.body as { workspaceId?: string } | undefined)?.workspaceId)] },
    async (request, reply) => {
      const req = request as Authed;
      const parsed = CreateProjectInputSchema.safeParse(request.body);
      if (!parsed.success) return Errors.validation(reply, 'Invalid input', zodDetails(parsed.error));
      const [p] = await db
        .insert(projects)
        .values({ workspaceId: parsed.data.workspaceId, name: parsed.data.name, description: parsed.data.description })
        .returning();
      const { ip, userAgent } = requestMeta(request);
      await audit(db, { userId: req.user.rawId, action: 'project.create', ip, userAgent, meta: { projectId: p.id } });
      return reply.code(201).send({ project: toProjectApi(p, 0) });
    },
  );

  // ---- get
  app.get(`${prefix}/:id`, { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const p = await projectGuard(db, request, reply, id, 'viewer');
    if (!p) return;
    return { project: toProjectApi(p, await campaignCountFor(db, p.id)) };
  });

  // ---- update
  app.patch(`${prefix}/:id`, { preHandler: [app.authenticate] }, async (request, reply) => {
    const req = request as Authed;
    const { id } = request.params as { id: string };
    const p = await projectGuard(db, request, reply, id, 'editor');
    if (!p) return;
    const parsed = UpdateProjectInputSchema.safeParse(request.body);
    if (!parsed.success) return Errors.validation(reply, 'Invalid input', zodDetails(parsed.error));
    if (Object.keys(parsed.data).length === 0) return sendError(reply, 400, 'BAD_REQUEST', 'Nothing to update');
    const [updated] = await db
      .update(projects)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(projects.id, id))
      .returning();
    const { ip, userAgent } = requestMeta(request);
    await audit(db, { userId: req.user.rawId, action: 'project.update', ip, userAgent, meta: { projectId: id } });
    return { project: toProjectApi(updated, await campaignCountFor(db, id)) };
  });

  // ---- delete
  app.delete(`${prefix}/:id`, { preHandler: [app.authenticate] }, async (request, reply) => {
    const req = request as Authed;
    const { id } = request.params as { id: string };
    const p = await projectGuard(db, request, reply, id, 'editor');
    if (!p) return;
    await db.delete(projects).where(eq(projects.id, id));
    const { ip, userAgent } = requestMeta(request);
    await audit(db, { userId: req.user.rawId, action: 'project.delete', ip, userAgent, meta: { projectId: id } });
    return { ok: true };
  });

  // ---- favorite toggle
  app.post(`${prefix}/:id/favorite`, { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const p = await projectGuard(db, request, reply, id, 'viewer');
    if (!p) return;
    const parsed = FavoriteProjectInputSchema.safeParse(request.body);
    if (!parsed.success) return Errors.validation(reply, 'Invalid input', zodDetails(parsed.error));
    const [updated] = await db
      .update(projects)
      .set({ isFavorite: parsed.data.favorite, updatedAt: new Date() })
      .where(eq(projects.id, id))
      .returning();
    return { project: toProjectApi(updated, await campaignCountFor(db, id)) };
  });
}
