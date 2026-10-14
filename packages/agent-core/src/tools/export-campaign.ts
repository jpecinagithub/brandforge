/**
 * export_campaign (read) — builds a JSON manifest
 * {campaign, brandKit, copies, assets} for a campaign and stores it as a
 * design document {kind:'export'}. Read-only apart from the manifest row.
 * Cost estimate: 0 (no model call).
 */
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import {
  assets,
  brandKits,
  campaigns,
  designDocuments,
} from '@brandforge/database';
import type { AgentTool, ToolContext, ToolResult } from '../types.js';
import {
  assertProjectAccess,
  parseToolArgs,
  ToolAuthError,
} from './helpers.js';

const argsSchema = z.object({
  campaignId: z.string().uuid(),
});

type Args = z.infer<typeof argsSchema>;

export const exportCampaignTool: AgentTool<Args> = {
  name: 'export_campaign',
  category: 'read',
  description:
    'Exports a campaign as a JSON manifest (campaign, brand kit, copies, assets) stored as a design document.',
  schema: argsSchema,
  // Heuristic: read-only queries + one manifest row → no marginal cost.
  estimateUsd: () => 0,
  async execute(ctx: ToolContext, args: Args): Promise<ToolResult> {
    const a = parseToolArgs(argsSchema, args) as Args;
    await assertProjectAccess(ctx);

    const [campaign] = await ctx.db
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, a.campaignId));
    if (!campaign || campaign.projectId !== ctx.projectId) {
      throw new ToolAuthError('Campaign not found in this project');
    }
    const [kit] = await ctx.db
      .select()
      .from(brandKits)
      .where(eq(brandKits.projectId, ctx.projectId));
    const docs = await ctx.db
      .select()
      .from(designDocuments)
      .where(eq(designDocuments.projectId, ctx.projectId));
    const assetRows = await ctx.db
      .select()
      .from(assets)
      .where(eq(assets.projectId, ctx.projectId));

    const manifest = {
      kind: 'campaign_export',
      exportedAt: new Date().toISOString(),
      campaign: {
        id: campaign.id,
        name: campaign.name,
        objective: campaign.objective,
        status: campaign.status,
      },
      brandKit: kit
        ? {
            brandName: kit.brandName,
            tagline: kit.tagline,
            description: kit.description,
            colors: kit.colors,
            fonts: kit.fonts,
            tone: kit.tone,
            audience: kit.audience,
          }
        : null,
      copies: docs
        .filter(
          (d) => (d.canvas as Record<string, unknown>)?.kind === 'marketing_copy',
        )
        .map((d) => ({ id: d.id, name: d.name, canvas: d.canvas })),
      assets: assetRows.map((r) => ({
        assetId: r.id,
        name: r.originalName,
        mimeType: r.mime,
        kind: r.kind,
        sizeBytes: r.sizeBytes,
      })),
    };

    const [doc] = await ctx.db
      .insert(designDocuments)
      .values({
        projectId: ctx.projectId,
        name: `Export — ${campaign.name}`.slice(0, 200),
        canvas: { kind: 'export', campaignId: campaign.id, manifest },
      })
      .returning();

    return {
      ok: true,
      summary: `Campaign "${campaign.name}" exported (${manifest.copies.length} copie(s), ${manifest.assets.length} asset(s)).`,
      data: { designDocumentId: doc.id, manifest },
    };
  },
};
