/**
 * create_landing_page (generate) — stores a landing page structure JSON in
 * landing_pages. The visual builder that renders/edits it ships in Phase 4;
 * this tool is data-only (documented in the stored schema).
 *
 * Cost estimate heuristic: $0.01 (structure assembly; the copy itself comes
 * from generate_marketing_copy when needed).
 */
import { z } from 'zod';
import { landingPages } from '@brandforge/database';
import type { AgentTool, ToolContext, ToolResult } from '../types.js';
import { assertProjectAccess, parseToolArgs } from './helpers.js';

const sectionSchema = z.object({
  heading: z.string().max(200),
  body: z.string().max(2000),
});

const argsSchema = z.object({
  template: z.enum(['hero', 'minimal']),
  headline: z.string().trim().min(1).max(200),
  sections: z.array(sectionSchema).max(12).optional(),
});

type Args = z.infer<typeof argsSchema>;

function defaultSections(template: 'hero' | 'minimal'): { heading: string; body: string }[] {
  return template === 'hero'
    ? [
        { heading: 'Hero', body: 'Headline, subheadline and primary call to action.' },
        { heading: 'Benefits', body: 'Three key benefits of the offer.' },
        { heading: 'Social proof', body: 'Testimonials or logos.' },
        { heading: 'Final CTA', body: 'Closing call to action.' },
      ]
    : [
        { heading: 'Headline', body: 'Single focused message.' },
        { heading: 'CTA', body: 'One call to action.' },
      ];
}

export const createLandingPageTool: AgentTool<Args> = {
  name: 'create_landing_page',
  category: 'generate',
  description:
    'Creates a landing page structure (template, headline, sections) stored as data; rendered by the visual builder in Phase 4.',
  schema: argsSchema,
  estimateUsd: () => 0.01,
  async execute(ctx: ToolContext, args: Args): Promise<ToolResult> {
    const a = parseToolArgs(argsSchema, args) as Args;
    await assertProjectAccess(ctx);

    const schema = {
      kind: 'landing_page',
      template: a.template,
      headline: a.headline,
      sections: a.sections ?? defaultSections(a.template),
      version: 1,
      builderNote:
        'Data-only structure. The visual builder (Phase 4) renders and edits this schema.',
      createdAt: new Date().toISOString(),
    };

    const [page] = await ctx.db
      .insert(landingPages)
      .values({ projectId: ctx.projectId, name: a.headline.slice(0, 200), schema })
      .returning();

    return {
      ok: true,
      summary: `Landing page "${a.headline}" created (template: ${a.template}).`,
      data: { landingPageId: page.id, schema },
    };
  },
};
