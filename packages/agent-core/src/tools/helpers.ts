/**
 * Shared helpers for agent tools: authorization, arg validation, stable
 * hashing (tool-call idempotency) and the budget-refusal result shape.
 *
 * Security rules enforced here and in every tool:
 * - No child_process, no raw SQL (Drizzle only), no eval/Function.
 * - Every tool verifies the project belongs to ctx.workspaceId before
 *   touching data (authorization boundary).
 * - AI output is never turned into commands; it is only stored as content.
 */
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { projects, type Project } from '@brandforge/database';
import type { ToolResult } from '../types.js';

/** Stable result code the orchestrator recognises as "park for approval". */
export const BUDGET_NOT_AFFORDABLE = 'BUDGET_NOT_AFFORDABLE';

export class ToolError extends Error {
  readonly code: string;

  constructor(message: string, code = 'TOOL_ERROR') {
    super(message);
    this.name = 'ToolError';
    this.code = code;
  }
}

export class ToolAuthError extends ToolError {
  constructor(message = 'Project does not belong to this workspace') {
    super(message, 'FORBIDDEN');
    this.name = 'ToolAuthError';
  }
}

/** Authorization boundary: the project must belong to ctx.workspaceId. */
export async function assertProjectAccess(ctx: {
  db: import('@brandforge/database').Db;
  workspaceId: string;
  projectId: string;
}): Promise<Project> {
  const [project] = await ctx.db
    .select()
    .from(projects)
    .where(eq(projects.id, ctx.projectId));
  if (!project || project.workspaceId !== ctx.workspaceId) {
    throw new ToolAuthError();
  }
  return project;
}

/** Zod-validates raw plan args; throws ToolError('INVALID_ARGS') on failure. */
export function parseToolArgs(schema: z.ZodTypeAny, args: unknown): any {
  const parsed = schema.safeParse(args);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new ToolError(`Invalid arguments: ${details}`, 'INVALID_ARGS');
  }
  return parsed.data;
}

/** Canonical JSON: object keys sorted recursively, so key order is stable. */
function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`)
      .join(',')}}`;
  }
  const json = JSON.stringify(value);
  return json === undefined ? 'null' : json;
}

/**
 * Stable SHA-256 over canonicalized args. Used as agent_tool_calls.args_hash
 * so retried steps reuse the recorded result instead of re-executing.
 */
export function stableHash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

/**
 * The ok:false result shape for "budget cannot cover this generation".
 * The orchestrator converts it into waiting_approval.
 */
export function budgetRefusal(reason: string, requestedUsd: number): ToolResult {
  return {
    ok: false,
    summary: `Budget check failed: ${reason}`,
    data: { code: BUDGET_NOT_AFFORDABLE, reason, requestedUsd },
  };
}

/** Deep-merges plain objects (arrays and scalars are replaced, not merged). */
export function deepMerge(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    const existing = out[key];
    if (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      existing !== null &&
      typeof existing === 'object' &&
      !Array.isArray(existing)
    ) {
      out[key] = deepMerge(
        existing as Record<string, unknown>,
        value as Record<string, unknown>,
      );
    } else {
      out[key] = value;
    }
  }
  return out;
}
