/**
 * @brandforge/shared — agent contracts.
 *
 * Single source of truth for the agent orchestrator shapes shared by
 * @brandforge/agent-core (orchestrator + tools), apps/api (routes + SSE),
 * apps/worker (job runner) and apps/web (progress UI).
 *
 * DO NOT import server-only code from here. Zod schemas only + plain types.
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Run states (spec §8 — explicit, observable state machine)
// ---------------------------------------------------------------------------
export const RUN_STATES = [
  'pending',
  'planning',
  'running',
  'waiting_approval',
  'completed',
  'failed',
  'cancelled',
] as const;
export const RunStateSchema = z.enum(RUN_STATES);
export type RunState = z.infer<typeof RunStateSchema>;

/** Allowed transitions of the run state machine. Anything else is a bug. */
export const RUN_TRANSITIONS: Record<RunState, readonly RunState[]> = {
  pending: ['planning', 'cancelled', 'failed'],
  planning: ['running', 'waiting_approval', 'failed', 'cancelled'],
  running: ['waiting_approval', 'completed', 'failed', 'cancelled'],
  waiting_approval: ['running', 'cancelled', 'failed'],
  completed: [],
  failed: ['pending', 'running'], // resume continues a stored plan when available
  cancelled: ['pending', 'running'], // likewise for a cancelled planned run
};

export function canTransition(from: RunState, to: RunState): boolean {
  return RUN_TRANSITIONS[from].includes(to);
}

// ---------------------------------------------------------------------------
// Tool categories (spec §9 — read / write / generate / publish separation)
// ---------------------------------------------------------------------------
export const TOOL_CATEGORIES = ['read', 'write', 'generate', 'publish'] as const;
export const ToolCategorySchema = z.enum(TOOL_CATEGORIES);
export type ToolCategory = z.infer<typeof ToolCategorySchema>;

/** The 13 tools of the agent registry. Names are stable API. */
export const TOOL_NAMES = [
  'create_campaign',
  'update_campaign',
  'create_brand_kit',
  'generate_marketing_copy',
  'generate_image',
  'generate_social_post',
  'create_poster',
  'create_landing_page',
  'edit_design',
  'save_asset',
  'list_project_assets',
  'export_campaign',
  'review_campaign',
] as const;
export const ToolNameSchema = z.enum(TOOL_NAMES);
export type ToolName = z.infer<typeof ToolNameSchema>;

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------
export const PlanStepSchema = z.object({
  id: z.string().min(1).max(40),
  tool: ToolNameSchema,
  title: z.string().min(1).max(200),
  args: z.record(z.string(), z.unknown()),
  dependsOn: z.array(z.string()).default([]),
  role: z.string().max(60).optional(),
});
export type PlanStep = z.infer<typeof PlanStepSchema>;

export const AgentPlanSchema = z.object({
  steps: z.array(PlanStepSchema).min(1).max(50),
  estimatedCostUsd: z.number().nonnegative().optional(),
  notes: z.string().max(2000).optional(),
});
export type AgentPlan = z.infer<typeof AgentPlanSchema>;

// ---------------------------------------------------------------------------
// Agent events (persisted to agent_events; streamed over SSE)
// ---------------------------------------------------------------------------
export const AGENT_EVENT_TYPES = [
  'run.started',
  'run.state',
  'run.plan',
  'run.recovering',
  'run.progress',
  'step.started',
  'step.completed',
  'step.failed',
  'tool.started',
  'tool.completed',
  'run.waiting_approval',
  'run.finished',
  'usage',
] as const;
export const AgentEventTypeSchema = z.enum(AGENT_EVENT_TYPES);
export type AgentEventType = z.infer<typeof AgentEventTypeSchema>;

export const AgentEventSchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  seq: z.number().int().nonnegative(),
  type: AgentEventTypeSchema,
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
});
export type AgentEvent = z.infer<typeof AgentEventSchema>;

// ---------------------------------------------------------------------------
// API DTOs
// ---------------------------------------------------------------------------
export const StartRunInputSchema = z.object({
  input: z.string().trim().min(1, 'Input is required').max(4000),
  idempotencyKey: z.string().trim().min(8).max(100).optional(),
  maxSteps: z.number().int().min(1).max(50).default(25),
  budgetUsd: z.number().positive().max(50).optional(),
  language: z.enum(['en', 'es']).optional(),
});
export type StartRunInput = z.infer<typeof StartRunInputSchema>;

export const AgentRunSchema = z.object({
  id: z.string().uuid(),
  campaignId: z.string().uuid(),
  conversationId: z.string().uuid().nullable(),
  state: RunStateSchema,
  input: z.string(),
  plan: AgentPlanSchema.nullable(),
  completedSteps: z.number().int().nonnegative(),
  totalSteps: z.number().int().nonnegative(),
  costUsd: z.string().nullable(),
  error: z.string().nullable(),
  approval: z
    .object({
      reason: z.string(),
      requestedBudgetUsd: z.number(),
    })
    .nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AgentRun = z.infer<typeof AgentRunSchema>;

export const AgentStepSchema = z.object({
  id: z.string().uuid(),
  planStepId: z.string().optional(),
  stepNo: z.number().int(),
  title: z.string(),
  tool: z.string(),
  state: z.string(),
  error: z.string().nullable(),
});
export type AgentStep = z.infer<typeof AgentStepSchema>;

export const ApproveRunInputSchema = z.object({
  approved: z.boolean(),
  budgetUsd: z.number().positive().max(50).optional(),
});
export type ApproveRunInput = z.infer<typeof ApproveRunInputSchema>;

export const ModelUsageSummarySchema = z.object({
  model: z.string(),
  calls: z.number().int(),
  tokensIn: z.number().int(),
  tokensOut: z.number().int(),
  costUsd: z.string().nullable(),
});
export type ModelUsageSummary = z.infer<typeof ModelUsageSummarySchema>;

export const CreditLedgerEntrySchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  delta: z.string(),
  kind: z.enum(['grant', 'reserve', 'settle', 'refund']),
  refType: z.string(),
  refId: z.string().uuid().nullable(),
  balanceAfter: z.string(),
  createdAt: z.string(),
});
export type CreditLedgerEntry = z.infer<typeof CreditLedgerEntrySchema>;

export const QuotaStatusSchema = z.object({
  plan: z.string(),
  creditsBalance: z.string(),
  aiGenerationsUsed: z.number().int(),
  aiGenerationsLimit: z.number().int(),
  aiEnabled: z.boolean(),
});
export type QuotaStatus = z.infer<typeof QuotaStatusSchema>;
