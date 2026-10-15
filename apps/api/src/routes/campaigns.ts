/** Canonical campaign routes. Projects remain a private compatibility detail. */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { count, eq, inArray } from 'drizzle-orm';
import { assets, campaigns, projects, type Campaign, type Db, type Project } from '@brandforge/database';
import { CreateCampaignInputSchema, CreateRootCampaignInputSchema, UpdateCampaignInputSchema } from '@brandforge/shared';
import { getDb } from '../db.js';
import { Errors, isUuid, sendError, zodDetails } from '../errors.js';
import { audit, getMembership, requestMeta, requireWorkspaceRole } from '../authz.js';
import { projectGuard } from './projects.js';

type Authed = FastifyRequest & { user: NonNullable<FastifyRequest['user']> };

function toCampaignApi(project: Project, detail: Campaign, assetCount = 0) {
  return {
    id: project.id,
    workspaceId: project.workspaceId,
    name: detail.name,
    objective: detail.objective,
    brief: detail.brief,
    audience: detail.audience,
    deliverables: detail.deliverables,
    status: detail.status,
    isFavorite: detail.isFavorite,
    assetCount,
    updatedAt: (detail.updatedAt ?? project.updatedAt ?? detail.createdAt).toISOString(),
  };
}

async function detailFor(db: Db, campaignId: string): Promise<Campaign | null> {
  const [detail] = await db.select().from(campaigns).where(eq(campaigns.projectId, campaignId)).limit(1);
  return detail ?? null;
}

async function assetsFor(db: Db, campaignId: string): Promise<number> {
  const [row] = await db.select({ total: count() }).from(assets).where(eq(assets.projectId, campaignId));
  return row?.total ?? 0;
}

async function campaignGuard(db: Db, request: FastifyRequest, reply: FastifyReply, id: string, role: 'viewer' | 'editor') {
  if (!isUuid(id)) { await Errors.notFound(reply); return null; }
  const project = await projectGuard(db, request, reply, id, role);
  if (!project) return null;
  const detail = await detailFor(db, id);
  if (!detail) { await Errors.notFound(reply); return null; }
  return { project, detail };
}

export async function campaignRoutes(app: FastifyInstance): Promise<void> {
  const db: Db = getDb();

  app.get('/api/v1/campaigns', { preHandler: [app.authenticate] }, async (request, reply) => {
    const req = request as Authed;
    const { workspaceId } = request.query as { workspaceId?: string };
    if (!workspaceId) return sendError(reply, 400, 'BAD_REQUEST', 'workspaceId query param is required');
    if (!isUuid(workspaceId)) return sendError(reply, 400, 'BAD_REQUEST', 'workspaceId must be a valid UUID');
    if (!(await getMembership(db, req.user.rawId, workspaceId))) return Errors.notFound(reply);

    const roots = await db.select().from(projects).where(eq(projects.workspaceId, workspaceId));
    if (roots.length === 0) return { campaigns: [] };
    const ids = roots.map((root) => root.id);
    const [details, assetCounts] = await Promise.all([
      db.select().from(campaigns).where(inArray(campaigns.projectId, ids)),
      db.select({ campaignId: assets.projectId, total: count() }).from(assets).where(inArray(assets.projectId, ids)).groupBy(assets.projectId),
    ]);
    const detailByRoot = new Map(details.map((detail) => [detail.projectId, detail]));
    const assetsByRoot = new Map(assetCounts.map((row) => [row.campaignId, row.total]));
    return {
      campaigns: roots.flatMap((root) => {
        const detail = detailByRoot.get(root.id);
        return detail ? [toCampaignApi(root, detail, assetsByRoot.get(root.id) ?? 0)] : [];
      }),
    };
  });

  app.post('/api/v1/campaigns', {
    preHandler: [app.authenticate, requireWorkspaceRole(db, 'editor', (request) => (request.body as { workspaceId?: string } | undefined)?.workspaceId)],
  }, async (request, reply) => {
    const req = request as Authed;
    const parsed = CreateRootCampaignInputSchema.safeParse(request.body);
    if (!parsed.success) return Errors.validation(reply, 'Invalid input', zodDetails(parsed.error));
    const created = await db.transaction(async (tx) => {
      const [project] = await tx.insert(projects).values({
        workspaceId: parsed.data.workspaceId,
        name: parsed.data.name,
        description: parsed.data.brief,
      }).returning();
      const [detail] = await tx.insert(campaigns).values({
        projectId: project.id,
        name: parsed.data.name,
        objective: parsed.data.objective,
        brief: parsed.data.brief,
        audience: parsed.data.audience,
        deliverables: parsed.data.deliverables,
      }).returning();
      return { project, detail };
    });
    const { ip, userAgent } = requestMeta(request);
    await audit(db, { userId: req.user.rawId, action: 'campaign.create', ip, userAgent, meta: { campaignId: created.project.id } });
    return reply.code(201).send({ campaign: toCampaignApi(created.project, created.detail) });
  });

  app.get('/api/v1/campaigns/:id', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const found = await campaignGuard(db, request, reply, id, 'viewer');
    if (!found) return;
    return { campaign: toCampaignApi(found.project, found.detail, await assetsFor(db, id)) };
  });

  app.patch('/api/v1/campaigns/:id', { preHandler: [app.authenticate] }, async (request, reply) => {
    const req = request as Authed;
    const { id } = request.params as { id: string };
    const found = await campaignGuard(db, request, reply, id, 'editor');
    if (!found) return;
    const parsed = UpdateCampaignInputSchema.safeParse(request.body);
    if (!parsed.success) return Errors.validation(reply, 'Invalid input', zodDetails(parsed.error));
    if (Object.keys(parsed.data).length === 0) return sendError(reply, 400, 'BAD_REQUEST', 'Nothing to update');
    const updated = await db.transaction(async (tx) => {
      const [project] = await tx.update(projects).set({
        ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
        ...(parsed.data.brief !== undefined ? { description: parsed.data.brief } : {}),
        updatedAt: new Date(),
      }).where(eq(projects.id, id)).returning();
      const [detail] = await tx.update(campaigns).set({ ...parsed.data, updatedAt: new Date() }).where(eq(campaigns.projectId, id)).returning();
      return { project, detail };
    });
    const { ip, userAgent } = requestMeta(request);
    await audit(db, { userId: req.user.rawId, action: 'campaign.update', ip, userAgent, meta: { campaignId: id } });
    return { campaign: toCampaignApi(updated.project, updated.detail, await assetsFor(db, id)) };
  });

  app.delete('/api/v1/campaigns/:id', { preHandler: [app.authenticate] }, async (request, reply) => {
    const req = request as Authed;
    const { id } = request.params as { id: string };
    const found = await campaignGuard(db, request, reply, id, 'editor');
    if (!found) return;
    await db.delete(projects).where(eq(projects.id, id));
    const { ip, userAgent } = requestMeta(request);
    await audit(db, { userId: req.user.rawId, action: 'campaign.delete', ip, userAgent, meta: { campaignId: id } });
    return { ok: true };
  });

  // Temporary compatibility for pre-migration clients that create the detail after a project.
  app.post('/api/v1/projects/:projectId/campaigns', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = await projectGuard(db, request, reply, projectId, 'editor');
    if (!project) return;
    const parsed = CreateCampaignInputSchema.safeParse(request.body);
    if (!parsed.success) return Errors.validation(reply, 'Invalid input', zodDetails(parsed.error));
    const existing = await detailFor(db, projectId);
    const [detail] = existing
      ? await db.update(campaigns).set({ ...parsed.data, updatedAt: new Date() }).where(eq(campaigns.id, existing.id)).returning()
      : await db.insert(campaigns).values({ projectId, ...parsed.data }).returning();
    return reply.code(existing ? 200 : 201).send({ campaign: toCampaignApi(project, detail) });
  });

  app.get('/api/v1/projects/:projectId/campaigns', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = await projectGuard(db, request, reply, projectId, 'viewer');
    if (!project) return;
    const detail = await detailFor(db, projectId);
    return { campaigns: detail ? [toCampaignApi(project, detail, await assetsFor(db, projectId))] : [] };
  });
}
