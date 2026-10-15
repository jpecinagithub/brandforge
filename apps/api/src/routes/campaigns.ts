/** Campaign routes: /api/v1/projects/:projectId/campaigns* and /api/v1/campaigns/:id* */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import { campaigns, type Campaign, type Db } from '@brandforge/database';
import { CreateCampaignInputSchema, UpdateCampaignInputSchema } from '@brandforge/shared';
import { getDb } from '../db.js';
import { Errors, sendError, zodDetails } from '../errors.js';
import { audit, requestMeta } from '../authz.js';
import { projectGuard } from './projects.js';

type Authed = FastifyRequest & { user: NonNullable<FastifyRequest['user']> };

export function toCampaignApi(c: Campaign) {
  return {
    id: c.id,
    projectId: c.projectId,
    name: c.name,
    objective: c.objective,
    brief: c.brief,
    audience: c.audience,
    deliverables: c.deliverables,
    status: c.status,
    isFavorite: c.isFavorite,
    updatedAt: c.updatedAt ? c.updatedAt.toISOString() : c.createdAt.toISOString(),
  };
}

/** Resolve a campaign and enforce min role on its project's workspace. 404 otherwise. */
async function campaignGuard(
  db: Db,
  request: FastifyRequest,
  reply: FastifyReply,
  campaignId: string,
  minRole: 'viewer' | 'editor',
): Promise<Campaign | null> {
  const [c] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId)).limit(1);
  if (!c) {
    await Errors.notFound(reply);
    return null;
  }
  const p = await projectGuard(db, request, reply, c.projectId, minRole);
  return p ? c : null;
}

export async function campaignRoutes(app: FastifyInstance): Promise<void> {
  const db: Db = getDb();

  app.get('/api/v1/projects/:projectId/campaigns', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const p = await projectGuard(db, request, reply, projectId, 'viewer');
    if (!p) return;
    const rows = await db.select().from(campaigns).where(eq(campaigns.projectId, projectId));
    return { campaigns: rows.map(toCampaignApi) };
  });

  app.post('/api/v1/projects/:projectId/campaigns', { preHandler: [app.authenticate] }, async (request, reply) => {
    const req = request as Authed;
    const { projectId } = request.params as { projectId: string };
    const p = await projectGuard(db, request, reply, projectId, 'editor');
    if (!p) return;
    const parsed = CreateCampaignInputSchema.safeParse(request.body);
    if (!parsed.success) return Errors.validation(reply, 'Invalid input', zodDetails(parsed.error));
    const [existing] = await db.select().from(campaigns).where(eq(campaigns.projectId, projectId)).limit(1);
    if (existing) {
      const [updated] = await db.update(campaigns).set({ ...parsed.data, updatedAt: new Date() }).where(eq(campaigns.id, existing.id)).returning();
      return reply.send({ campaign: toCampaignApi(updated) });
    }
    const [c] = await db
      .insert(campaigns)
      .values({ projectId, ...parsed.data })
      .returning();
    const { ip, userAgent } = requestMeta(request);
    await audit(db, { userId: req.user.rawId, action: 'campaign.create', ip, userAgent, meta: { campaignId: c.id } });
    return reply.code(201).send({ campaign: toCampaignApi(c) });
  });

  app.get('/api/v1/campaigns/:id', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const c = await campaignGuard(db, request, reply, id, 'viewer');
    if (!c) return;
    return { campaign: toCampaignApi(c) };
  });

  app.patch('/api/v1/campaigns/:id', { preHandler: [app.authenticate] }, async (request, reply) => {
    const req = request as Authed;
    const { id } = request.params as { id: string };
    const c = await campaignGuard(db, request, reply, id, 'editor');
    if (!c) return;
    const parsed = UpdateCampaignInputSchema.safeParse(request.body);
    if (!parsed.success) return Errors.validation(reply, 'Invalid input', zodDetails(parsed.error));
    if (Object.keys(parsed.data).length === 0) return sendError(reply, 400, 'BAD_REQUEST', 'Nothing to update');
    const [updated] = await db
      .update(campaigns)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(campaigns.id, id))
      .returning();
    const { ip, userAgent } = requestMeta(request);
    await audit(db, { userId: req.user.rawId, action: 'campaign.update', ip, userAgent, meta: { campaignId: id } });
    return { campaign: toCampaignApi(updated) };
  });

  app.delete('/api/v1/campaigns/:id', { preHandler: [app.authenticate] }, async (request, reply) => {
    const req = request as Authed;
    const { id } = request.params as { id: string };
    const c = await campaignGuard(db, request, reply, id, 'editor');
    if (!c) return;
    await db.delete(campaigns).where(eq(campaigns.id, id));
    const { ip, userAgent } = requestMeta(request);
    await audit(db, { userId: req.user.rawId, action: 'campaign.delete', ip, userAgent, meta: { campaignId: id } });
    return { ok: true };
  });
}
