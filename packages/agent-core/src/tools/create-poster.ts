/**
 * create_poster (generate) — builds a poster layout JSON from the brand kit
 * (colors/fonts) with an optional AI image, stored as a design document
 * {kind:'poster'}. The visual builder that renders it ships in Phase 4.
 *
 * Cost estimate heuristic: $0.02 base + $0.04 when imagePrompt is present.
 */
import { Buffer } from 'node:buffer';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { assets, brandKits, designDocuments } from '@brandforge/database';
import type { AgentTool, ToolContext, ToolResult } from '../types.js';
import { assertProjectAccess, parseToolArgs } from './helpers.js';

const IMAGE_ESTIMATE_USD = 0.04;

const argsSchema = z.object({
  title: z.string().trim().min(1).max(200),
  subtitle: z.string().trim().max(300).optional(),
  imagePrompt: z.string().trim().min(1).max(2000).optional(),
  brandKitId: z.string().uuid().optional(),
});

type Args = z.infer<typeof argsSchema>;

export const createPosterTool: AgentTool<Args> = {
  name: 'create_poster',
  category: 'generate',
  description:
    'Creates a poster layout (title, subtitle, brand colors/fonts, optional AI image) stored as a design document.',
  schema: argsSchema,
  estimateUsd: (args: Args) => 0.02 + (args.imagePrompt ? IMAGE_ESTIMATE_USD : 0),
  async execute(ctx: ToolContext, args: Args): Promise<ToolResult> {
    const a = parseToolArgs(argsSchema, args) as Args;
    await assertProjectAccess(ctx);

    let kit: { colors: unknown; fonts: unknown; tone: string } | null = null;
    if (a.brandKitId) {
      const [row] = await ctx.db
        .select()
        .from(brandKits)
        .where(eq(brandKits.id, a.brandKitId));
      if (row && row.projectId === ctx.projectId) {
        kit = { colors: row.colors, fonts: row.fonts, tone: row.tone };
      }
    } else {
      const [row] = await ctx.db
        .select()
        .from(brandKits)
        .where(eq(brandKits.projectId, ctx.projectId));
      if (row) kit = { colors: row.colors, fonts: row.fonts, tone: row.tone };
    }

    let assetId: string | undefined;
    let imageUrl: string | undefined;
    let imageSkipped: string | undefined;
    let imageUsage: { tokensIn: number; tokensOut: number; costUsd?: number } | undefined;
    if (a.imagePrompt) {
      const affordability = await ctx.budget.checkAffordable(IMAGE_ESTIMATE_USD);
      if (!affordability.ok) {
        imageSkipped = affordability.reason ?? 'Image skipped: insufficient budget';
      } else {
        const imageModel = await ctx.router.select('image');
        const imageResult = await ctx.openrouter.generateImage({
          model: imageModel,
          prompt: a.imagePrompt,
          aspectRatio: '4:3',
          timeoutMs: 180000,
        });
        const saved = await ctx.storage.saveFile({
          data: Buffer.from(imageResult.imageBase64, 'base64'),
          mimeType: imageResult.mimeType,
          name: `poster-${Date.now()}.png`,
          kind: 'image',
        });
        await ctx.db
          .update(assets)
          .set({ projectId: ctx.projectId })
          .where(eq(assets.id, saved.assetId));
        assetId = saved.assetId;
        imageUrl = saved.url;
        imageUsage = imageResult.usage;
      }
    }

    const layout = {
      kind: 'poster',
      title: a.title,
      subtitle: a.subtitle ?? '',
      colors: (kit?.colors as string[]) ?? [],
      fonts: (kit?.fonts as string[]) ?? [],
      tone: kit?.tone ?? '',
      imageAssetId: assetId ?? null,
      version: 1,
      builderNote: 'Rendered by the visual builder (Phase 4); this document is data-only.',
    };

    const [doc] = await ctx.db
      .insert(designDocuments)
      .values({
        projectId: ctx.projectId,
        name: `Poster — ${a.title}`.slice(0, 200),
        canvas: { ...layout, createdAt: new Date().toISOString() },
      })
      .returning();

    const costUsd = imageUsage?.costUsd ?? 0;

    return {
      ok: true,
      summary: `Poster layout "${a.title}" created${assetId ? ' with image' : ''}${imageSkipped ? ` (image skipped: ${imageSkipped})` : ''}.`,
      data: {
        designDocumentId: doc.id,
        layout,
        assetId,
        imageUrl,
        imageSkipped,
      },
      usage: imageUsage
        ? { tokensIn: imageUsage.tokensIn, tokensOut: imageUsage.tokensOut, costUsd }
        : undefined,
      costUsd,
    };
  },
};
