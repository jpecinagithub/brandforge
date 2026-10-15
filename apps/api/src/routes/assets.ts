/**
 * Asset routes:
 *  POST /api/v1/assets (multipart: campaignId field + file) → 201 {asset}
 *  GET  /api/v1/campaigns/:campaignId/assets → {assets}
 *  GET  /api/v1/assets/:id → file download (auth + membership required)
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { assets, type Asset, type Db } from '@brandforge/database';
import { getDb } from '../db.js';
import { Errors, sendError } from '../errors.js';
import { audit, getMembership, requestMeta, roleAtLeast } from '../authz.js';
import { projectGuard } from './projects.js';
import { ASSET_MAX_BYTES, assetStorageCandidates, buildObjectPath, detectImage, getStorage } from '../storage.js';

type Authed = FastifyRequest & { user: NonNullable<FastifyRequest['user']> };

export function toAssetApi(a: Asset) {
  return {
    id: a.id,
    originalName: a.originalName,
    mime: a.mime,
    sizeBytes: a.sizeBytes,
    url: `/api/v1/assets/${a.id}`,
    kind: a.kind,
    width: a.width,
    height: a.height,
  };
}

export async function assetRoutes(app: FastifyInstance): Promise<void> {
  const db: Db = getDb();

  app.post('/api/v1/assets', { preHandler: [app.authenticate] }, async (request, reply) => {
    const req = request as Authed;
    const data = await request.file();
    if (!data) return sendError(reply, 400, 'BAD_REQUEST', 'No file uploaded');
    const fields = data.fields as unknown as Record<string, { value?: unknown } | undefined>;
    const projectId = fields['campaignId']?.value ?? fields['projectId']?.value;
    if (typeof projectId !== 'string' || projectId.length === 0) {
      return sendError(reply, 400, 'BAD_REQUEST', 'campaignId field is required');
    }
    const p = await projectGuard(db, request, reply, projectId, 'editor');
    if (!p) return;
    const buf = await data.toBuffer();
    if (buf.length > ASSET_MAX_BYTES) {
      return sendError(reply, 413, 'FILE_TOO_LARGE', 'Asset must be 10MB or smaller');
    }
    const detected = detectImage(buf);
    if (!detected) {
      return sendError(reply, 415, 'UNSUPPORTED_FILE', 'Asset must be a PNG, JPEG, GIF or WebP image');
    }
    const storage = getStorage();
    const assetId = randomUUID();
    const rel = buildObjectPath('assets', assetId, `asset${detected.ext}`);
    await storage.put(rel, buf);
    let row: Asset;
    try {
      [row] = await db
        .insert(assets)
        .values({
          id: assetId,
          workspaceId: p.workspaceId,
          projectId: p.id,
          filename: rel,
          originalName: data.filename,
          mime: detected.mime,
          sizeBytes: buf.length,
          kind: 'image',
        })
        .returning();
    } catch (error) {
      await storage.remove(rel);
      throw error;
    }
    const { ip, userAgent } = requestMeta(request);
    await audit(db, { userId: req.user.rawId, action: 'asset.upload', ip, userAgent, meta: { assetId: row.id } });
    return reply.code(201).send({ asset: toAssetApi(row) });
  });

  const listAssets = async (request: FastifyRequest, reply: FastifyReply) => {
    const params = request.params as { projectId?: string; campaignId?: string };
    const projectId = params.campaignId ?? params.projectId ?? '';
    const p = await projectGuard(db, request, reply, projectId, 'viewer');
    if (!p) return;
    const rows = await db.select().from(assets).where(eq(assets.projectId, projectId));
    return { assets: rows.map(toAssetApi) };
  };
  app.get('/api/v1/campaigns/:campaignId/assets', { preHandler: [app.authenticate] }, listAssets);
  app.get('/api/v1/projects/:projectId/assets', { preHandler: [app.authenticate] }, listAssets);

  app.get('/api/v1/assets/:id', { preHandler: [app.authenticate] }, async (request, reply) => {
    const req = request as Authed;
    const { id } = request.params as { id: string };
    const [a] = await db.select().from(assets).where(eq(assets.id, id)).limit(1);
    if (!a) return Errors.notFound(reply);
    const role = await getMembership(db, req.user.rawId, a.workspaceId);
    if (!roleAtLeast(role, 'viewer')) return Errors.notFound(reply);
    const storage = getStorage();
    for (const rel of assetStorageCandidates(a.filename, a.workspaceId)) {
      try {
        const data = await storage.get(rel);
        // The SPA is served from Vercel while private assets live on the Oracle
        // API origin. Helmet defaults CORP to `same-origin`, which makes the
        // browser discard an otherwise-authorized <img> response. This only
        // permits cross-origin embedding; the session and workspace membership
        // checks above still protect the file itself.
        return reply
          .header('Cross-Origin-Resource-Policy', 'cross-origin')
          .header('Cache-Control', 'private, no-store')
          .type(a.mime)
          .header('content-length', data.length)
          .send(data);
      } catch {
        // Try the next legacy layout before declaring the file missing.
      }
    }
    return Errors.notFound(reply, 'File not found on disk');
  });
}
