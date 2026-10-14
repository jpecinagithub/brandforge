/**
 * generate_image (generate) — budget-gated image generation.
 *
 * Flow: estimate → budget.checkAffordable FIRST (no model call, no spend
 * when unaffordable) → router.select('image') → openrouter.generateImage →
 * storage.saveFile → link the asset row to the project.
 *
 * When unaffordable it returns ok:false with code BUDGET_NOT_AFFORDABLE;
 * the orchestrator converts that into waiting_approval.
 *
 * Cost estimate heuristic: flat $0.04 per image (typical image-model price).
 * Real cost is recorded from the provider's usage, never from this estimate.
 */
import { Buffer } from 'node:buffer';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { assets } from '@brandforge/database';
import type { AgentTool, ToolContext, ToolResult } from '../types.js';
import {
  assertProjectAccess,
  budgetRefusal,
  parseToolArgs,
} from './helpers.js';

const IMAGE_ESTIMATE_USD = 0.04;

const argsSchema = z.object({
  prompt: z.string().trim().min(1).max(2000),
  aspectRatio: z.enum(['1:1', '16:9', '9:16', '4:3']).optional(),
  name: z.string().trim().min(1).max(200).optional(),
});

type Args = z.infer<typeof argsSchema>;

export const generateImageTool: AgentTool<Args> = {
  name: 'generate_image',
  category: 'generate',
  description:
    'Generates an image from a prompt with the image model and stores it as a project asset.',
  schema: argsSchema,
  estimateUsd: () => IMAGE_ESTIMATE_USD,
  async execute(ctx: ToolContext, args: Args): Promise<ToolResult> {
    const a = parseToolArgs(argsSchema, args) as Args;
    await assertProjectAccess(ctx);

    // Budget gate FIRST: never start an expensive generation without a quota check.
    const affordability = await ctx.budget.checkAffordable(IMAGE_ESTIMATE_USD);
    if (!affordability.ok) {
      return budgetRefusal(
        affordability.reason ?? 'Insufficient budget for image generation',
        IMAGE_ESTIMATE_USD,
      );
    }

    const model = await ctx.router.select('image');
    const result = await ctx.openrouter.generateImage({
      model,
      prompt: a.prompt,
      aspectRatio: a.aspectRatio,
      timeoutMs: 180000,
    });

    const data = Buffer.from(result.imageBase64, 'base64');
    const saved = await ctx.storage.saveFile({
      data,
      mimeType: result.mimeType,
      name: a.name ?? `image-${Date.now()}.png`,
      kind: 'image',
    });
    // The storage port owns the asset row; ensure it is linked to this project.
    await ctx.db
      .update(assets)
      .set({ projectId: ctx.projectId })
      .where(eq(assets.id, saved.assetId));

    return {
      ok: true,
      summary: 'Image generated and stored as an asset.',
      data: {
        assetId: saved.assetId,
        url: saved.url,
        model,
        revisedPrompt: result.revisedPrompt,
      },
      usage: result.usage,
      costUsd: result.usage.costUsd,
    };
  },
};
