/**
 * save_asset (write) — stores a base64-encoded image (≤10MB, image/* mime)
 * via the storage port and links the asset row to the current project.
 * Cost estimate: 0 (no model call; storage only).
 */
import { Buffer } from 'node:buffer';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { assets } from '@brandforge/database';
import type { AgentTool, ToolContext, ToolResult } from '../types.js';
import { assertProjectAccess, parseToolArgs, ToolError } from './helpers.js';

const MAX_BYTES = 10 * 1024 * 1024; // 10MB

const argsSchema = z.object({
  name: z.string().trim().min(1).max(200),
  kind: z.string().trim().min(1).max(40),
  mimeType: z.string().trim().min(1).max(100),
  dataBase64: z.string().min(1),
});

type Args = z.infer<typeof argsSchema>;

export const saveAssetTool: AgentTool<Args> = {
  name: 'save_asset',
  category: 'write',
  description:
    'Saves a base64-encoded image (max 10MB, image/* MIME types only) as a project asset.',
  schema: argsSchema,
  // Heuristic: no LLM call, storage only → no marginal cost.
  estimateUsd: () => 0,
  async execute(ctx: ToolContext, args: Args): Promise<ToolResult> {
    const a = parseToolArgs(argsSchema, args) as Args;
    await assertProjectAccess(ctx);
    if (!a.mimeType.toLowerCase().startsWith('image/')) {
      throw new ToolError(
        `Unsupported MIME type "${a.mimeType}": only image/* is accepted`,
        'INVALID_MIME',
      );
    }
    let data: Buffer;
    try {
      data = Buffer.from(a.dataBase64, 'base64');
    } catch {
      throw new ToolError('dataBase64 is not valid base64', 'INVALID_ARGS');
    }
    if (data.length === 0) {
      throw new ToolError('Empty file payload', 'INVALID_ARGS');
    }
    if (data.length > MAX_BYTES) {
      throw new ToolError(
        `File is ${(data.length / 1024 / 1024).toFixed(1)}MB; the 10MB limit was exceeded`,
        'FILE_TOO_LARGE',
      );
    }
    const saved = await ctx.storage.saveFile({
      data,
      mimeType: a.mimeType,
      name: a.name,
      kind: a.kind,
    });
    await ctx.db
      .update(assets)
      .set({ projectId: ctx.projectId })
      .where(eq(assets.id, saved.assetId));
    return {
      ok: true,
      summary: `Asset "${a.name}" saved (${(data.length / 1024).toFixed(1)} KB).`,
      data: { assetId: saved.assetId, url: saved.url, sizeBytes: data.length },
    };
  },
};
