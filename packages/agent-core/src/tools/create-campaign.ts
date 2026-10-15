/**
 * create_campaign (write) — creates the campaign or reuses the current one.
 * Cost estimate: 0 (pure DB write, no model call).
 */
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { campaigns } from '@brandforge/database';
import type { AgentTool, ToolContext, ToolResult } from '../types.js';
import { assertProjectAccess, parseToolArgs } from './helpers.js';

const argsSchema = z.object({
  name: z.string().trim().min(1).max(200),
  objective: z.string().max(2000).default(''),
});

type Args = z.infer<typeof argsSchema>;

export const createCampaignTool: AgentTool<Args> = {
  name: 'create_campaign',
  category: 'write',
  description:
    'Creates the marketing campaign only when the current workspace has none; otherwise updates and reuses the existing campaign.',
  schema: argsSchema,
  // Heuristic: no LLM call, only a DB insert → no marginal cost.
  estimateUsd: () => 0,
  async execute(ctx: ToolContext, args: Args): Promise<ToolResult> {
    const a = parseToolArgs(argsSchema, args) as Args;
    await assertProjectAccess(ctx);
    const [existing] = await ctx.db.select().from(campaigns).where(eq(campaigns.projectId, ctx.projectId));
    const [row] = existing
      ? await ctx.db.update(campaigns).set({ name: a.name, objective: a.objective, updatedAt: new Date() }).where(eq(campaigns.id, existing.id)).returning()
      : await ctx.db.insert(campaigns).values({ projectId: ctx.projectId, name: a.name, objective: a.objective }).returning();
    return {
      ok: true,
      summary: existing ? `Campaign "${row.name}" updated.` : `Campaign "${row.name}" created.`,
      data: { campaignId: row.id, name: row.name, objective: row.objective },
    };
  },
};
