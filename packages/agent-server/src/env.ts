/**
 * Environment readers for the agent engine. All runtime limits are env-config
 * (ADR-0006); nothing is hardcoded in the UI or the orchestrator.
 */

export interface AgentConfig {
  maxSteps: number;
  stepTimeoutMs: number;
  runTimeoutMs: number;
  defaultBudgetUsd: number;
  maxAttempts: number;
}

function intFrom(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const n = Number.parseInt(value, 10);
  if (Number.isNaN(n)) throw new Error(`Invalid integer env value: ${value}`);
  return n;
}

function floatFrom(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const n = Number.parseFloat(value);
  if (Number.isNaN(n)) throw new Error(`Invalid numeric env value: ${value}`);
  return n;
}

function boolFrom(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`Invalid boolean env value: ${value}`);
}

export function readAgentConfig(
  source: Record<string, string | undefined> = process.env,
): AgentConfig {
  return {
    maxSteps: intFrom(source.AGENT_MAX_STEPS, 25),
    stepTimeoutMs: intFrom(source.AGENT_STEP_TIMEOUT_MS, 120_000),
    runTimeoutMs: intFrom(source.AGENT_RUN_TIMEOUT_MS, 1_800_000),
    defaultBudgetUsd: floatFrom(source.AGENT_DEFAULT_BUDGET_USD, 2.0),
    maxAttempts: intFrom(source.AGENT_MAX_ATTEMPTS, 3),
  };
}

export interface QuotaPlanDefaults {
  aiEnabled: boolean;
  generationsLimit: number;
  monthlyCreditsUsd: number;
}

/** Monthly allowance defaults per plan (spec §17; demo gets nothing by default). */
export function readQuotaPlanDefaults(
  source: Record<string, string | undefined> = process.env,
): Record<'demo' | 'free' | 'pro', QuotaPlanDefaults> {
  return {
    demo: {
      aiEnabled: boolFrom(source.DEMO_AI_ENABLED, false),
      generationsLimit: intFrom(source.DEMO_MONTHLY_AI_GENERATIONS, 2),
      monthlyCreditsUsd: floatFrom(source.DEMO_MONTHLY_CREDITS_USD, 0.15),
    },
    free: {
      aiEnabled: true,
      generationsLimit: intFrom(source.FREE_MONTHLY_AI_CREDITS, 100),
      monthlyCreditsUsd: floatFrom(source.FREE_MONTHLY_CREDITS_USD, 5),
    },
    pro: {
      aiEnabled: true,
      generationsLimit: intFrom(source.PRO_MONTHLY_AI_CREDITS, 1000),
      monthlyCreditsUsd: floatFrom(source.PRO_MONTHLY_CREDITS_USD, 50),
    },
  };
}
