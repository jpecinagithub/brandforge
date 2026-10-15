# @brandforge/agent-core

Production agentic engine: orchestrator, planner, tool registry and the 13
agent tools. This package executes AI through `@brandforge/integrations`
(OpenRouter, server-side only).

## Layout

- `src/orchestrator.ts` — `Orchestrator`: `startRun` (idempotent),
  `executeRun` (worker entry point), `cancelRun`, `resumeRun`, `approveRun`.
  All transitions go through `assertTransition`.
- `src/planner.ts` — `planRun`: one JSON-mode LLM call → `AgentPlan`
  (Zod-validated, tools/dependencies/cycles checked, 1 retry).
- `src/state-machine.ts` — re-exports `canTransition` + `assertTransition`.
- `src/graph.ts` — topological levels for parallel step execution.
- `src/roles.ts` — the 6 logical roles as prompt modules (not processes).
- `src/memory.ts` — `DbMemoryStore` over `agent_memories`.
- `src/tools/` — the 13 tools + `createToolRegistry` / `createDefaultRegistry`.
- `src/types.ts` — public contracts (`AgentTool`, `ToolContext`, ports,
  `OrchestratorDeps`, …).

## Notes for integrators

- The OpenRouter shapes in `src/types.ts` (`OpenRouterClient`,
  `ModelRouter`, …) mirror the implemented interfaces in `@brandforge/integrations`;
  they are structurally identical, so the real classes are
  assignable without adaptation.
- `StoragePort.saveFile` is expected to persist the asset row and return its
  `assetId`; tools additionally set `projectId` on that row to guarantee
  project linkage.
- Cost is recorded ONLY from provider `usage` data. `estimateUsd` values are
  documented heuristics for budget guards, never billed amounts.
- `src/__tests__/fakes.ts` is TEST-ONLY (in-memory Db/ports for unit tests).
  Real-DB paths are covered by the backend integration tests.
