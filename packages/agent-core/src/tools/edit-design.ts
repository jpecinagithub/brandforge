/**
 * edit_design (write) — deep-merges a patch into a design document's canvas.
 * The document must belong to the current project (authorization).
 * Cost estimate: 0 (pure DB write, no model call).
 */
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { designDocuments } from '@brandforge/database';
import type { AgentTool, ToolContext, ToolResult } from '../types.js';
import {
  assertProjectAccess,
  deepMerge,
  parseToolArgs,
  ToolAuthError,
} from './helpers.js';

const argsSchema = z.object({
  designDocumentId: z.string().uuid(),
  patch: z.record(z.string(), z.unknown()),
});

type Args = z.infer<typeof argsSchema>;

export const editDesignTool: AgentTool<Args> = {
  name: 'edit_design',
  category: 'write',
  description:
    'Applies a JSON patch (deep merge) to a design document of the current project.',
  schema: argsSchema,
  // Heuristic: no LLM call, only a DB update → no marginal cost.
  estimateUsd: () => 0,
  async execute(ctx: ToolContext, args: Args): Promise<ToolResult> {
    const a = parseToolArgs(argsSchema, args) as Args;
    await assertProjectAccess(ctx);
    const [doc] = await ctx.db
      .select()
      .from(designDocuments)
      .where(eq(designDocuments.id, a.designDocumentId));
    if (!doc || doc.projectId !== ctx.projectId) {
      throw new ToolAuthError('Design document not found in this project');
    }
    const canvas = deepMerge(
      (doc.canvas as Record<string, unknown>) ?? {},
      a.patch,
    );
    const [updated] = await ctx.db
      .update(designDocuments)
      .set({ canvas, updatedAt: new Date() })
      .where(eq(designDocuments.id, a.designDocumentId))
      .returning();
    return {
      ok: true,
      summary: `Design document "${updated.name}" patched.`,
      data: { designDocumentId: updated.id, canvas: updated.canvas },
    };
  },
};
