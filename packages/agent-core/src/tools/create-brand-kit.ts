/**
 * create_brand_kit (write) — upserts the project's brand kit (one per project).
 * Cost estimate: 0 (pure DB write, no model call).
 */
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { brandKits } from '@brandforge/database';
import type { AgentTool, ToolContext, ToolResult } from '../types.js';
import { assertProjectAccess, parseToolArgs } from './helpers.js';

const argsSchema = z.object({
  brandName: z.string().trim().min(1).max(200),
  tagline: z.string().max(500).default(''),
  description: z.string().max(5000).default(''),
  colors: z.array(z.string().max(40)).max(20).default([]),
  fonts: z.array(z.string().max(100)).max(20).default([]),
  tone: z.string().max(2000).default(''),
  audience: z.string().max(2000).default(''),
});

type Args = z.infer<typeof argsSchema>;

export const createBrandKitTool: AgentTool<Args> = {
  name: 'create_brand_kit',
  category: 'write',
  description:
    'Creates or replaces the brand kit of the current project (brand name, tagline, colors, fonts, tone, audience).',
  schema: argsSchema,
  // Heuristic: no LLM call, only a DB upsert → no marginal cost.
  estimateUsd: () => 0,
  async execute(ctx: ToolContext, args: Args): Promise<ToolResult> {
    const a = parseToolArgs(argsSchema, args) as Args;
    await assertProjectAccess(ctx);
    const values = {
      projectId: ctx.projectId,
      brandName: a.brandName,
      tagline: a.tagline,
      description: a.description,
      colors: a.colors,
      fonts: a.fonts,
      tone: a.tone,
      audience: a.audience,
      updatedAt: new Date(),
    };
    const [existing] = await ctx.db
      .select({ id: brandKits.id })
      .from(brandKits)
      .where(eq(brandKits.projectId, ctx.projectId));
    const [kit] = existing
      ? await ctx.db
          .update(brandKits)
          .set(values)
          .where(eq(brandKits.id, existing.id))
          .returning()
      : await ctx.db.insert(brandKits).values(values).returning();
    return {
      ok: true,
      summary: `Brand kit "${kit.brandName}" saved.`,
      data: {
        brandKitId: kit.id,
        brandName: kit.brandName,
        tagline: kit.tagline,
        colors: kit.colors,
        fonts: kit.fonts,
        tone: kit.tone,
        audience: kit.audience,
      },
    };
  },
};
