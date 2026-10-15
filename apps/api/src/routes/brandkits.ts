/** Brand kit routes scoped to the canonical campaign id (upsert). */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import { brandKits, type BrandKit, type Db } from '@brandforge/database';
import { UpsertBrandKitInputSchema } from '@brandforge/shared';
import { getDb } from '../db.js';
import { Errors, zodDetails } from '../errors.js';
import { audit, requestMeta } from '../authz.js';
import { projectGuard } from './projects.js';

type Authed = FastifyRequest & { user: NonNullable<FastifyRequest['user']> };

export function toBrandKitApi(k: BrandKit) {
  return {
    id: k.id,
    campaignId: k.projectId,
    brandName: k.brandName,
    tagline: k.tagline,
    description: k.description,
    colors: k.colors as string[],
    fonts: k.fonts as string[],
    tone: k.tone,
    audience: k.audience,
    updatedAt: k.updatedAt ? k.updatedAt.toISOString() : k.createdAt.toISOString(),
  };
}

export async function brandKitRoutes(app: FastifyInstance): Promise<void> {
  const db: Db = getDb();

  const getBrandKit = async (request: FastifyRequest, reply: FastifyReply) => {
    const params = request.params as { projectId?: string; campaignId?: string };
    const projectId = params.campaignId ?? params.projectId ?? '';
    const p = await projectGuard(db, request, reply, projectId, 'viewer');
    if (!p) return;
    const [kit] = await db.select().from(brandKits).where(eq(brandKits.projectId, projectId)).limit(1);
    if (!kit) return Errors.notFound(reply, 'Brand kit not found');
    return { brandKit: toBrandKitApi(kit) };
  };
  app.get('/api/v1/campaigns/:campaignId/brand-kit', { preHandler: [app.authenticate] }, getBrandKit);
  app.get('/api/v1/projects/:projectId/brand-kit', { preHandler: [app.authenticate] }, getBrandKit);

  const putBrandKit = async (request: FastifyRequest, reply: FastifyReply) => {
    const req = request as Authed;
    const params = request.params as { projectId?: string; campaignId?: string };
    const projectId = params.campaignId ?? params.projectId ?? '';
    const p = await projectGuard(db, request, reply, projectId, 'editor');
    if (!p) return;
    const parsed = UpsertBrandKitInputSchema.safeParse(request.body);
    if (!parsed.success) return Errors.validation(reply, 'Invalid input', zodDetails(parsed.error));
    const now = new Date();
    const [existing] = await db.select({ id: brandKits.id }).from(brandKits).where(eq(brandKits.projectId, projectId)).limit(1);
    let kit: BrandKit;
    if (existing) {
      [kit] = await db
        .update(brandKits)
        .set({ ...parsed.data, updatedAt: now })
        .where(eq(brandKits.id, existing.id))
        .returning();
    } else {
      [kit] = await db.insert(brandKits).values({ projectId, ...parsed.data }).returning();
    }
    const { ip, userAgent } = requestMeta(request);
    await audit(db, { userId: req.user.rawId, action: 'brandkit.upsert', ip, userAgent, meta: { projectId } });
    return { brandKit: toBrandKitApi(kit) };
  };
  app.put('/api/v1/campaigns/:campaignId/brand-kit', { preHandler: [app.authenticate] }, putBrandKit);
  app.put('/api/v1/projects/:projectId/brand-kit', { preHandler: [app.authenticate] }, putBrandKit);
}
