/**
 * Orchestrator wiring — the single place that assembles the agent engine.
 *
 * Reads tunables from env (readAgentConfig), builds the OpenRouter client +
 * model router via @brandforge/integrations, the tool registry via
 * @brandforge/agent-core, and our port implementations. Everything the
 * worker and the HTTP layer need flows through `buildOrchestrator`.
 */
import {
  Orchestrator,
  allTools,
  createToolRegistry,
  type ModelRouter as ModelRouterPort,
  type OpenRouterClient as OpenRouterClientPort,
  type OrchestratorDeps,
  type ToolRegistry,
} from '@brandforge/agent-core';
import {
  createOpenRouterClient,
  readOpenRouterEnv,
  ModelRouter,
} from '@brandforge/integrations';
import type { Db } from '@brandforge/database';
import { readAgentConfig } from './env.js';
import { makeBudget, makeConversation, makeEmit, makeMemory, makeStorage } from './ports.js';
import type { OrchestratorConfig } from './types.js';

export interface BuildOrchestratorOpts {
  storagePath: string;
  /**
   * TEST-ONLY seams. The worker and the API never pass these; integration
   * tests inject a fake OpenRouter client / router / tool registry so no
   * network is ever touched.
   */
  overrides?: {
    openrouter?: OpenRouterClientPort;
    router?: ModelRouterPort;
    registry?: ToolRegistry;
  };
}

/** Build a fully-wired orchestrator for one process (worker or API). */
export function buildOrchestrator(db: Db, opts: BuildOrchestratorOpts): Orchestrator {
  const agentCfg = readAgentConfig();
  const orEnv = readOpenRouterEnv();
  const client: OpenRouterClientPort =
    opts.overrides?.openrouter ?? createOpenRouterClient(orEnv);
  const router: ModelRouterPort = opts.overrides?.router ?? new ModelRouter(orEnv, client);
  const registry: ToolRegistry =
    opts.overrides?.registry ?? createToolRegistry(allTools);

  const emit = makeEmit(db);
  const config: OrchestratorConfig = {
    maxSteps: agentCfg.maxSteps,
    stepTimeoutMs: agentCfg.stepTimeoutMs,
    runTimeoutMs: agentCfg.runTimeoutMs,
    defaultBudgetUsd: agentCfg.defaultBudgetUsd,
    maxAttempts: agentCfg.maxAttempts,
  };

  const deps: OrchestratorDeps = {
    db,
    openrouter: client,
    router,
    registry,
    config,
    ports: {
      makeEmit: (runId: string) => {
        const emitOne = emit(runId);
        return async (type, payload) => {
          await emitOne(type, payload);
        };
      },
      makeBudget: (p: { runId: string; workspaceId: string }) =>
        makeBudget(db, p.workspaceId, p.runId),
      makeStorage: (p: { workspaceId: string }) => makeStorage(db, p.workspaceId, opts.storagePath),
      makeConversation: () => makeConversation(db),
      makeMemory: () => makeMemory(db),
    },
    // Events are persisted by the per-run port (the SSE endpoint tails
    // agent_events); there is no pub/sub fan-out yet, so the global
    // broadcast is intentionally a no-op. Persisting here as well would
    // duplicate every event row.
    emitGlobal: async () => {},
  };
  return new Orchestrator(deps);
}

/**
 * Server-side OpenRouter client (for the isConfigured() gate in routes).
 * Never throws on missing config — returns a client whose isConfigured()
 * is false instead.
 */
export function getOpenRouterClient(): { isConfigured(): boolean } {
  try {
    return createOpenRouterClient(readOpenRouterEnv());
  } catch {
    return { isConfigured: () => false };
  }
}

/** True when the server can actually call OpenRouter (key present). */
export function isAiConfigured(): boolean {
  try {
    return getOpenRouterClient().isConfigured();
  } catch {
    return false;
  }
}
