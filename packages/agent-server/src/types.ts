/**
 * Port interfaces the orchestrator consumes. The canonical contracts live in
 * @brandforge/agent-core (types.ts) — this module re-exports them and adds
 * the backend-specific extension:
 *
 * - BudgetPort.abort(): release a pending credit hold when a run fails
 *   without settling (the orchestrator never settles a step whose tool
 *   threw). The worker also runs a ledger reconciliation after executeRun
 *   as a second line of defense.
 */
import type { BudgetPort as CoreBudgetPort } from '@brandforge/agent-core';

export type {
  ConversationPort,
  MemoryStore,
  OrchestratorConfig,
  StoragePort,
  ToolResult,
} from '@brandforge/agent-core';

/** Backend budget port: core contract + hold release. */
export interface BudgetPort extends CoreBudgetPort {
  /** Release the pending reservation without charging (run failed/cancelled). */
  abort(): Promise<void>;
}

export type { CoreBudgetPort };
