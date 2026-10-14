/**
 * generate_social_post (generate) — copy via the text model plus an optional
 * inline image. The image leg is budget-checked independently: when
 * unaffordable the copy is still delivered and the skip is reported honestly
 * (data.imageSkipped) instead of failing the whole tool.
 *
 * Cost estimate heuristic: $0.015 base + $0.04 when imagePrompt is present.
 */
import { Buffer } from 'node:buffer';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { assets, designDocuments } from '@brandforge/database';
import type { AgentTool, ToolContext, ToolResult } from '../types.js';
import { assertProjectAccess, parseToolArgs, ToolError } from './helpers.js';
import { contentCreator } from '../roles.js';

const IMAGE_ESTIMATE_USD = 0.04;

const argsSchema = z.object({
  platform: z.enum(['instagram', 'linkedin', 'facebook']),
  topic: z.string().trim().min(1).max(500),
  imagePrompt: z.string().trim().min(1).max(2000).optional(),
});

type Args = z.infer<typeof argsSchema>;

const copySchema = z.object({
  caption: z.string(),
  hashtags: z.array(z.string()).default([]),
});

export const generateSocialPostTool: AgentTool<Args> = {
  name: 'generate_social_post',
  category: 'generate',
  description:
    'Generates a social media post (caption + hashtags) for a platform, with an optional AI-generated image.',
  schema: argsSchema,
  estimateUsd: (args: Args) => 0.015 + (args.imagePrompt ? IMAGE_ESTIMATE_USD : 0),
  async execute(ctx: ToolContext, args: Args): Promise<ToolResult> {
    const a = parseToolArgs(argsSchema, args) as Args;
    await assertProjectAccess(ctx);

    const textModel = await ctx.router.select('text');
    const copyResult = await ctx.openrouter.chat({
      model: textModel,
      messages: [
        { role: 'system', content: contentCreator.systemPrompt(ctx.language) },
        {
          role: 'user',
          content: JSON.stringify({
            task: 'Write a social media post.',
            platform: a.platform,
            topic: a.topic,
            language: ctx.language,
            format: 'Return ONLY JSON: {"caption":string,"hashtags":[string]}',
          }),
        },
      ],
      maxTokens: 1200,
      temperature: 0.7,
      jsonMode: true,
      timeoutMs: 120000,
    });

    let copy: z.infer<typeof copySchema>;
    try {
      copy = copySchema.parse(JSON.parse(copyResult.content));
    } catch {
      throw new ToolError('Model returned invalid post JSON', 'MODEL_OUTPUT_INVALID');
    }

    let assetId: string | undefined;
    let imageUrl: string | undefined;
    let imageModel: string | undefined;
    let imageSkipped: string | undefined;
    let imageUsage: { tokensIn: number; tokensOut: number; costUsd?: number } | undefined;

    if (a.imagePrompt) {
      const affordability = await ctx.budget.checkAffordable(IMAGE_ESTIMATE_USD);
      if (!affordability.ok) {
        imageSkipped =
          affordability.reason ?? 'Image skipped: insufficient budget';
      } else {
        imageModel = await ctx.router.select('image');
        const imageResult = await ctx.openrouter.generateImage({
          model: imageModel,
          prompt: a.imagePrompt,
          aspectRatio: a.platform === 'instagram' ? '1:1' : '16:9',
          timeoutMs: 180000,
        });
        const saved = await ctx.storage.saveFile({
          data: Buffer.from(imageResult.imageBase64, 'base64'),
          mimeType: imageResult.mimeType,
          name: `social-${a.platform}-${Date.now()}.png`,
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

    const tokensIn = copyResult.usage.tokensIn + (imageUsage?.tokensIn ?? 0);
    const tokensOut = copyResult.usage.tokensOut + (imageUsage?.tokensOut ?? 0);
    const costUsd =
      (copyResult.usage.costUsd ?? 0) + (imageUsage?.costUsd ?? 0);

    const [doc] = await ctx.db
      .insert(designDocuments)
      .values({
        projectId: ctx.projectId,
        name: `Social post — ${a.platform} — ${a.topic}`.slice(0, 200),
        canvas: {
          kind: 'social_post',
          platform: a.platform,
          topic: a.topic,
          language: ctx.language,
          caption: copy.caption,
          hashtags: copy.hashtags,
          assetId: assetId ?? null,
          imageSkipped: imageSkipped ?? null,
          models: { text: textModel, image: imageModel ?? null },
          createdAt: new Date().toISOString(),
        },
      })
      .returning();

    return {
      ok: true,
      summary: imageSkipped
        ? `Post copy generated for ${a.platform}; image skipped (${imageSkipped}).`
        : `Social post generated for ${a.platform}${assetId ? ' with image' : ''}.`,
      data: {
        designDocumentId: doc.id,
        platform: a.platform,
        caption: copy.caption,
        hashtags: copy.hashtags,
        assetId,
        imageUrl,
        imageSkipped,
        model: textModel,
      },
      usage: { tokensIn, tokensOut, costUsd },
      costUsd,
    };
  },
};
