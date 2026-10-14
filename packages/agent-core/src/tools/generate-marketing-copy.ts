/**
 * generate_marketing_copy (generate) — asks the text model for channel
 * variants and stores them as a design document {kind:'marketing_copy'}.
 *
 * Cost estimate heuristic: one chat call of ~1-2k tokens → $0.01 base +
 * $0.002 per channel (longer output). Real cost is recorded from the
 * provider's usage, never from this estimate.
 */
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { brandKits, designDocuments } from '@brandforge/database';
import type { AgentTool, ToolContext, ToolResult } from '../types.js';
import { assertProjectAccess, parseToolArgs, ToolError } from './helpers.js';
import { contentCreator } from '../roles.js';

const variantSchema = z.object({
  channel: z.string(),
  headline: z.string(),
  body: z.string(),
  cta: z.string(),
});

const argsSchema = z.object({
  topic: z.string().trim().min(1).max(500),
  channels: z.array(z.string().trim().min(1).max(60)).min(1).max(10),
  tone: z.string().max(200).optional(),
  language: z.enum(['en', 'es']).optional(),
});

type Args = z.infer<typeof argsSchema>;

export const generateMarketingCopyTool: AgentTool<Args> = {
  name: 'generate_marketing_copy',
  category: 'generate',
  description:
    'Generates marketing copy variants (headline, body, CTA) for the given channels and stores them as a design document.',
  schema: argsSchema,
  estimateUsd: (args: Args) => 0.01 + 0.002 * (args.channels?.length ?? 1),
  async execute(ctx: ToolContext, args: Args): Promise<ToolResult> {
    const a = parseToolArgs(argsSchema, args) as Args;
    await assertProjectAccess(ctx);
    const language = a.language ?? ctx.language;

    const [kit] = await ctx.db
      .select()
      .from(brandKits)
      .where(eq(brandKits.projectId, ctx.projectId));
    const brandLine = kit
      ? `Brand: ${kit.brandName}. Tagline: ${kit.tagline}. Tone: ${kit.tone || a.tone || 'neutral'}. Audience: ${kit.audience}.`
      : `Tone: ${a.tone || 'neutral'}.`;

    const model = await ctx.router.select('text');
    const result = await ctx.openrouter.chat({
      model,
      messages: [
        { role: 'system', content: contentCreator.systemPrompt(language) },
        {
          role: 'user',
          content: JSON.stringify({
            task: 'Write marketing copy variants.',
            topic: a.topic,
            channels: a.channels,
            brand: brandLine,
            language,
            format: 'Return ONLY JSON: {"variants":[{"channel":string,"headline":string,"body":string,"cta":string}]}',
          }),
        },
      ],
      maxTokens: 2500,
      temperature: 0.7,
      jsonMode: true,
      timeoutMs: 120000,
    });

    let variants: z.infer<typeof variantSchema>[];
    try {
      const parsed = JSON.parse(result.content) as { variants?: unknown };
      variants = z.array(variantSchema).parse(parsed.variants);
    } catch {
      throw new ToolError('Model returned invalid copy JSON', 'MODEL_OUTPUT_INVALID');
    }

    const [doc] = await ctx.db
      .insert(designDocuments)
      .values({
        projectId: ctx.projectId,
        name: `Marketing copy — ${a.topic}`.slice(0, 200),
        canvas: {
          kind: 'marketing_copy',
          topic: a.topic,
          channels: a.channels,
          tone: a.tone ?? kit?.tone ?? '',
          language,
          variants,
          model,
          createdAt: new Date().toISOString(),
        },
      })
      .returning();

    return {
      ok: true,
      summary: `Generated ${variants.length} copy variant(s) for "${a.topic}".`,
      data: { designDocumentId: doc.id, variants, model },
      usage: result.usage,
      costUsd: result.usage.costUsd,
    };
  },
};
