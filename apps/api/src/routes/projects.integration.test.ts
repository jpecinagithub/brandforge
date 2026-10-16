/**
 * Integration: workspace → project → campaign → brand kit → chat stub.
 * The chat endpoint is an HONEST stub in Phase 2: it persists both messages
 * and replies with notice 'AI_NOT_CONFIGURED' without any network call.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { landingPages } from '@brandforge/database';
import { getDb } from '../db.js';

/** Mirrors tests/setup/no-network.ts (kept local so tsc stays happy). */
interface FetchAttempt {
  url: string;
  method: string;
}

import {
  authed,
  buildTestApp,
  clearMaildir,
  closeDb,
  createWorkspace,
  registerVerifyLogin,
  truncateDb,
} from '../test-utils.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildTestApp();
});
afterAll(async () => {
  await app.close();
  await closeDb();
});
/** Fetch attempts recorded by tests/setup/no-network.ts (global fetch guard). */
function fetchAttempts(): FetchAttempt[] {
  return (globalThis as unknown as { __fetchCalls: FetchAttempt[] }).__fetchCalls ?? [];
}

beforeEach(async () => {
  await truncateDb();
  await clearMaildir();
  (globalThis as unknown as { __resetFetchCalls: () => void }).__resetFetchCalls();
});

/** Minimal 1x1 PNG (magic bytes only matter for detectImage). */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function multipartBody(boundary: string, fields: Record<string, string>, file: { field: string; filename: string; mime: string; data: Buffer }) {
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${file.field}"; filename="${file.filename}"\r\nContent-Type: ${file.mime}\r\n\r\n`,
    ),
  );
  parts.push(file.data);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  return Buffer.concat(parts);
}

describe('project workspace flow', () => {
  it('creates and manages a complete campaign through the canonical API', async () => {
    const { cookie } = await registerVerifyLogin(app);
    const workspaceId = await createWorkspace(app, cookie);

    const created = await app.inject(
      authed(cookie, {
        method: 'POST',
        url: '/api/v1/campaigns',
        payload: {
          workspaceId,
          name: 'Autumn launch',
          objective: 'Generate qualified leads',
          brief: 'Launch the new collection in October.',
          audience: 'Independent retailers',
          deliverables: ['brand_kit', 'landing_page'],
        },
      }),
    );
    expect(created.statusCode).toBe(201);
    const campaign = created.json().campaign as { id: string; workspaceId: string; assetCount: number };
    expect(campaign.workspaceId).toBe(workspaceId);
    expect(campaign.assetCount).toBe(0);

    const listed = await app.inject(authed(cookie, { method: 'GET', url: `/api/v1/campaigns?workspaceId=${workspaceId}` }));
    expect(listed.statusCode).toBe(200);
    expect(listed.json().campaigns).toHaveLength(1);
    expect(listed.json().campaigns[0].id).toBe(campaign.id);

    const updated = await app.inject(
      authed(cookie, { method: 'PATCH', url: `/api/v1/campaigns/${campaign.id}`, payload: { isFavorite: true } }),
    );
    expect(updated.statusCode).toBe(200);
    expect(updated.json().campaign.isFavorite).toBe(true);

    const brandKit = await app.inject(
      authed(cookie, {
        method: 'PUT',
        url: `/api/v1/campaigns/${campaign.id}/brand-kit`,
        payload: { brandName: 'Autumn Studio', colors: ['#7C3AED'] },
      }),
    );
    expect(brandKit.statusCode).toBe(200);

    const conversation = await app.inject(
      authed(cookie, { method: 'GET', url: `/api/v1/campaigns/${campaign.id}/conversation` }),
    );
    expect(conversation.statusCode).toBe(200);

    const removed = await app.inject(authed(cookie, { method: 'DELETE', url: `/api/v1/campaigns/${campaign.id}` }));
    expect(removed.statusCode).toBe(200);
    const missing = await app.inject(authed(cookie, { method: 'GET', url: `/api/v1/campaigns/${campaign.id}` }));
    expect(missing.statusCode).toBe(404);
  });

  it('project → campaign → brand kit → chat stub (AI_NOT_CONFIGURED, persisted)', async () => {
    const { cookie } = await registerVerifyLogin(app);
    const wsId = await createWorkspace(app, cookie);

    const pc = await app.inject(
      authed(cookie, { method: 'POST', url: '/api/v1/projects', payload: { workspaceId: wsId, name: 'Launch' } }),
    );
    expect(pc.statusCode).toBe(201);
    const projectId = (pc.json() as { project: { id: string } }).project.id;

    const cc = await app.inject(
      authed(cookie, {
        method: 'POST',
        url: `/api/v1/projects/${projectId}/campaigns`,
        payload: { name: 'Holiday push', objective: 'Drive pre-orders' },
      }),
    );
    expect(cc.statusCode).toBe(201);
    const campaignId = (cc.json() as { campaign: { id: string } }).campaign.id;

    const favoriteCampaign = await app.inject(
      authed(cookie, {
        method: 'PATCH',
        url: `/api/v1/campaigns/${campaignId}`,
        payload: { isFavorite: true },
      }),
    );
    expect(favoriteCampaign.statusCode).toBe(200);
    expect(favoriteCampaign.json().campaign.isFavorite).toBe(true);

    const bk = await app.inject(
      authed(cookie, {
        method: 'PUT',
        url: `/api/v1/projects/${projectId}/brand-kit`,
        payload: { brandName: 'Aroma Original', colors: ['#1E3D2F'], fonts: ['Inter'], tone: 'warm', audience: 'coffee lovers' },
      }),
    );
    expect(bk.statusCode).toBe(200);
    expect(bk.json().brandKit.brandName).toBe('Aroma Original');

    const bkGet = await app.inject(authed(cookie, { method: 'GET', url: `/api/v1/projects/${projectId}/brand-kit` }));
    expect(bkGet.json().brandKit.brandName).toBe('Aroma Original');

    // ---- chat stub
    const conv = await app.inject(authed(cookie, { method: 'GET', url: `/api/v1/projects/${projectId}/conversation` }));
    expect(conv.statusCode).toBe(200);
    const conversationId = (conv.json() as { conversation: { id: string } }).conversation.id;

    const msg = await app.inject(
      authed(cookie, {
        method: 'POST',
        url: `/api/v1/conversations/${conversationId}/messages`,
        payload: { content: 'Design a launch campaign for our oat-milk latte' },
      }),
    );
    expect(msg.statusCode).toBe(200);
    const body = msg.json() as {
      message: { role: string; content: string };
      reply: { role: string; content: string; notice: string };
    };
    expect(body.message.role).toBe('user');
    expect(body.message.content).toBe('Design a launch campaign for our oat-milk latte');
    expect(body.reply.role).toBe('assistant');
    expect(body.reply.notice).toBe('AI_NOT_CONFIGURED');
    expect(body.reply.content).toMatch(/temporarily unavailable/i);

    // both messages persisted
    const conv2 = await app.inject(authed(cookie, { method: 'GET', url: `/api/v1/projects/${projectId}/conversation` }));
    const messages = (conv2.json() as { messages: Array<{ role: string; content: string }> }).messages;
    expect(messages).toHaveLength(2);
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant']);

    // the stub made ZERO external HTTP calls (no OpenRouter, no billing)
    expect(fetchAttempts()).toHaveLength(0);
  });

  it('favorite toggle, asset upload, and project delete', async () => {
    const { cookie } = await registerVerifyLogin(app);
    const wsId = await createWorkspace(app, cookie);
    const pc = await app.inject(
      authed(cookie, { method: 'POST', url: '/api/v1/projects', payload: { workspaceId: wsId, name: 'Launch' } }),
    );
    const projectId = (pc.json() as { project: { id: string } }).project.id;

    const fav = await app.inject(
      authed(cookie, { method: 'POST', url: `/api/v1/projects/${projectId}/favorite`, payload: { favorite: true } }),
    );
    expect(fav.statusCode).toBe(200);
    expect(fav.json().project.isFavorite).toBe(true);

    const boundary = '----testboundary1234';
    const up = await app.inject(
      authed(cookie, {
        method: 'POST',
        url: '/api/v1/assets',
        headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
        payload: multipartBody(boundary, { projectId }, { field: 'file', filename: 'logo.png', mime: 'image/png', data: PNG_1X1 }),
      }),
    );
    expect(up.statusCode).toBe(201);
    expect(up.json().asset.mime).toBe('image/png');

    const assetId = (up.json() as { asset: { id: string } }).asset.id;
    const image = await app.inject(
      authed(cookie, {
        method: 'GET',
        url: `/api/v1/assets/${assetId}`,
        headers: { origin: 'https://brandforge-tan.vercel.app' },
      }),
    );
    expect(image.statusCode).toBe(200);
    expect(image.headers['content-type']).toMatch(/^image\/png/);
    expect(image.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(image.headers['cache-control']).toBe('private, no-store');

    const listed = await app.inject(
      authed(cookie, { method: 'GET', url: `/api/v1/projects/${projectId}/assets` }),
    );
    expect(listed.statusCode).toBe(200);
    const listedBody = listed.json() as {
      assets: Array<{ id: string; available: boolean; downloadUrl: string }>;
      verification: { total: number; available: number };
    };
    expect(listedBody.assets[0]).toMatchObject({
      id: assetId,
      available: true,
      downloadUrl: `/api/v1/assets/${assetId}?download=1`,
    });
    expect(listedBody.verification).toEqual(expect.objectContaining({ total: 1, available: 1 }));

    const download = await app.inject(
      authed(cookie, { method: 'GET', url: `/api/v1/assets/${assetId}?download=1` }),
    );
    expect(download.headers['content-disposition']).toContain('attachment');

    const del = await app.inject(authed(cookie, { method: 'DELETE', url: `/api/v1/projects/${projectId}` }));
    expect(del.statusCode).toBe(200);
    const gone = await app.inject(authed(cookie, { method: 'GET', url: `/api/v1/projects/${projectId}` }));
    expect(gone.statusCode).toBe(404);
  });

  it('a non-member gets 404 (not 403) on project-scoped writes', async () => {
    const owner = await registerVerifyLogin(app);
    const stranger = await registerVerifyLogin(app);
    const wsId = await createWorkspace(app, owner.cookie);

    // Phase 2 has no member-invite route, so this pins the documented
    // behaviour: non-members get 404 on project resources (no existence leak).
    const pc = await app.inject(
      authed(owner.cookie, { method: 'POST', url: '/api/v1/projects', payload: { workspaceId: wsId, name: 'Launch' } }),
    );
    const projectId = (pc.json() as { project: { id: string } }).project.id;

    const attempt = await app.inject(
      authed(stranger.cookie, {
        method: 'POST',
        url: `/api/v1/projects/${projectId}/campaigns`,
        payload: { name: 'Sneaky' },
      }),
    );
    expect(attempt.statusCode).toBe(404);
  });

  it('publishes a verified landing through a revocable public URL', async () => {
    const { cookie } = await registerVerifyLogin(app);
    const wsId = await createWorkspace(app, cookie);
    const pc = await app.inject(
      authed(cookie, { method: 'POST', url: '/api/v1/projects', payload: { workspaceId: wsId, name: 'Public launch' } }),
    );
    const projectId = (pc.json() as { project: { id: string } }).project.id;
    const [page] = await getDb().insert(landingPages).values({
      projectId,
      name: 'Public landing',
      schema: {
        headline: 'A verified landing',
        subheadline: 'Complete content ready to share.',
        cta: 'Discover it',
        sections: [{ heading: 'A real benefit', body: 'The complete supporting explanation.' }],
      },
    }).returning();

    const publish = await app.inject(
      authed(cookie, { method: 'POST', url: `/api/v1/landing-pages/${page.id}/publish` }),
    );
    expect(publish.statusCode).toBe(200);
    const published = publish.json() as { landingPage: { publicUrl: string; publishedAt: string } };
    expect(published.landingPage.publicUrl).toContain('/showcase/landing/');
    expect(published.landingPage.publishedAt).toBeTruthy();
    const publicId = published.landingPage.publicUrl.split('/').at(-1)!;

    const preview = await app.inject({
      method: 'GET',
      url: `/api/v1/public/landing-pages/${publicId}/preview`,
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.headers['content-type']).toContain('text/html');
    expect(preview.headers['cache-control']).toBe('no-store, max-age=0');
    expect(preview.body).toContain('A verified landing');

    const unpublish = await app.inject(
      authed(cookie, { method: 'DELETE', url: `/api/v1/landing-pages/${page.id}/publish` }),
    );
    expect(unpublish.statusCode).toBe(200);
    const revoked = await app.inject({ method: 'GET', url: `/api/v1/public/landing-pages/${publicId}/preview` });
    expect(revoked.statusCode).toBe(404);
  });
});
