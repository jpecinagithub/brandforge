/**
 * create_campaign (write) — inserts a campaign row for the current project.
 * Cost estimate: 0 (pure DB write, no model call).
 */
import { z } from 'zod';
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
    'Creates a new marketing campaign in the current project with a name and objective.',
  schema: argsSchema,
  // Heuristic: no LLM call, only a DB insert → no marginal cost.
  estimateUsd: () => 0,
  async execute(ctx: ToolContext, args: Args): Promise<ToolResult> {
    const a = parseToolArgs(argsSchema, args) as Args;
    await assertProjectAccess(ctx);
    const [row] = await ctx.db
      .insert(campaigns)
      .values({ projectId: ctx.projectId, name: a.name, objective: a.objective })
      .returning();
    return {
      ok: true,
      summary: `Campaign "${row.name}" created.`,
      data: { campaignId: row.id, name: row.name, objective: row.objective },
    };
  },
};
