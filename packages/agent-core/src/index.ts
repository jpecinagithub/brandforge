/**
 * @brandforge/agent-core — PHASE 3 STUB.
 *
 * The agent orchestrator, model router and tool executors live here in
 * Phase 3. Nothing in this package executes AI in Phases 1-2.
 */
export const AGENT_PHASE = 'stub' as const;

/** Typed tool contract the Phase 3 orchestrator will implement. */
export interface AgentTool<Input = unknown, Output = unknown> {
  name: string;
  description: string;
  execute(input: Input): Promise<Output>;
}

/**
 * Registry of the 13 planned agent tools. Empty on purpose — each entry is a
 * named NOT_IMPLEMENTED placeholder so Phase 3 code and docs can reference
 * them without anything being callable yet.
 */
export const PLANNED_TOOLS = [
  'brandkit.generate',
  'brandkit.refine',
  'campaign.create',
  'campaign.copywrite',
  'asset.generate_image',
  'asset.upload',
  'asset.transform',
  'landing.generate',
  'landing.publish',
  'design.canvas_create',
  'design.canvas_edit',
  'research.market_scan',
  'analytics.summarize',
] as const;

export type PlannedToolName = (typeof PLANNED_TOOLS)[number];

export const NOT_IMPLEMENTED: Record<PlannedToolName, 'NOT_IMPLEMENTED'> = Object.fromEntries(
  PLANNED_TOOLS.map((name) => [name, 'NOT_IMPLEMENTED']),
) as Record<PlannedToolName, 'NOT_IMPLEMENTED'>;

export const toolRegistry: Record<string, AgentTool> = {};
