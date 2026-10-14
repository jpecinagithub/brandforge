/**
 * review_campaign (generate) — the quality-reviewer role: the review model
 * scores the campaign's coherence against the brand kit and lists issues.
 *
 * Cost estimate heuristic: $0.01 (one short review-model call). Real cost is
 * recorded from the provider's usage, never from this estimate.
 */
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { brandKits, campaigns } from '@brandforge/database';
import type { AgentTool, ToolContext, ToolResult } from '../types.js';
import {
  assertProjectAccess,
  parseToolArgs,
  ToolAuthError,
  ToolError,
} from './helpers.js';
import { qualityReviewer } from '../roles.js';

const argsSchema = z.object({
  campaignId: z.string().uuid(),
});

type Args = z.infer<typeof argsSchema>;

const reviewSchema = z.object({
  score: z.number().min(0).max(100),
  issues: z.array(z.string()).default([]),
});

export const reviewCampaignTool: AgentTool<Args> = {
  name: 'review_campaign',
  category: 'generate',
  description:
    'Reviews a campaign for coherence with the brand kit; returns a 0-100 score and a list of issues.',
  schema: argsSchema,
  estimateUsd: () => 0.01,
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

    const model = await ctx.router.select('review');
    const result = await ctx.openrouter.chat({
      model,
      messages: [
        { role: 'system', content: qualityReviewer.systemPrompt(ctx.language) },
        {
          role: 'user',
          content: JSON.stringify({
            task: 'Review the campaign for brand coherence.',
            campaign: {
              name: campaign.name,
              objective: campaign.objective,
              status: campaign.status,
            },
            brandKit: kit
              ? {
                  brandName: kit.brandName,
                  tagline: kit.tagline,
                  tone: kit.tone,
                  audience: kit.audience,
                  colors: kit.colors,
                }
              : null,
            language: ctx.language,
            format: 'Return ONLY JSON: {"score":number (0-100),"issues":[string]}',
          }),
        },
      ],
      maxTokens: 1200,
      temperature: 0.3,
      jsonMode: true,
      timeoutMs: 120000,
    });

    let review: z.infer<typeof reviewSchema>;
    try {
      review = reviewSchema.parse(JSON.parse(result.content));
    } catch {
      throw new ToolError('Model returned invalid review JSON', 'MODEL_OUTPUT_INVALID');
    }

    return {
      ok: true,
      summary: `Campaign "${campaign.name}" scored ${review.score}/100 (${review.issues.length} issue(s)).`,
      data: {
        campaignId: campaign.id,
        score: review.score,
        issues: review.issues,
        model,
      },
      usage: result.usage,
      costUsd: result.usage.costUsd,
    };
  },
};
