/**
 * update_campaign (write) — patches name/objective/status of a campaign.
 * The campaign must belong to the current project (authorization).
 * Cost estimate: 0 (pure DB write, no model call).
 */
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { campaigns } from '@brandforge/database';
import type { AgentTool, ToolContext, ToolResult } from '../types.js';
import {
  assertProjectAccess,
  parseToolArgs,
  ToolAuthError,
  ToolError,
} from './helpers.js';

const argsSchema = z.object({
  campaignId: z.string().uuid(),
  name: z.string().trim().min(1).max(200).optional(),
  objective: z.string().max(2000).optional(),
  status: z.string().max(50).optional(),
});

type Args = z.infer<typeof argsSchema>;

export const updateCampaignTool: AgentTool<Args> = {
  name: 'update_campaign',
  category: 'write',
  description:
    'Updates name, objective and/or status of an existing campaign in the current project.',
  schema: argsSchema,
  // Heuristic: no LLM call, only a DB update → no marginal cost.
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
    const patch: { name?: string; objective?: string; status?: string } = {};
    if (a.name !== undefined) patch.name = a.name;
    if (a.objective !== undefined) patch.objective = a.objective;
    if (a.status !== undefined) patch.status = a.status;
    if (Object.keys(patch).length === 0) {
      throw new ToolError('Nothing to update: provide name, objective or status', 'INVALID_ARGS');
    }
    const [updated] = await ctx.db
      .update(campaigns)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(campaigns.id, a.campaignId))
      .returning();
    return {
      ok: true,
      summary: `Campaign "${updated.name}" updated.`,
      data: {
        campaignId: updated.id,
        name: updated.name,
        objective: updated.objective,
        status: updated.status,
      },
    };
  },
};
