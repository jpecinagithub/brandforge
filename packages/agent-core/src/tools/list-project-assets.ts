/**
 * list_project_assets (read) — lists the current project's assets,
 * optionally filtered by kind. Cost estimate: 0 (read-only DB query).
 */
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { assets } from '@brandforge/database';
import type { AgentTool, ToolContext, ToolResult } from '../types.js';
import { assertProjectAccess, parseToolArgs } from './helpers.js';

const argsSchema = z.object({
  kind: z.string().trim().min(1).max(40).optional(),
});

type Args = z.infer<typeof argsSchema>;

export const listProjectAssetsTool: AgentTool<Args> = {
  name: 'list_project_assets',
  category: 'read',
  description: 'Lists the assets of the current project, optionally filtered by kind.',
  schema: argsSchema,
  // Heuristic: read-only DB query → no marginal cost.
  estimateUsd: () => 0,
  async execute(ctx: ToolContext, args: Args): Promise<ToolResult> {
    const a = parseToolArgs(argsSchema, args) as Args;
    await assertProjectAccess(ctx);
    const rows = await ctx.db
      .select()
      .from(assets)
      .where(eq(assets.projectId, ctx.projectId));
    const filtered = a.kind ? rows.filter((r) => r.kind === a.kind) : rows;
    const items = filtered.map((r) => ({
      assetId: r.id,
      name: r.originalName,
      mimeType: r.mime,
      kind: r.kind,
      sizeBytes: r.sizeBytes,
      width: r.width,
      height: r.height,
      createdAt: r.createdAt?.toISOString?.() ?? null,
    }));
    return {
      ok: true,
      summary: `Found ${items.length} asset(s)${a.kind ? ` of kind "${a.kind}"` : ''}.`,
      data: { assets: items },
    };
  },
};
