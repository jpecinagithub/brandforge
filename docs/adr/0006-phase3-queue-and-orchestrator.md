# ADR-0006 — Phase 3: job queue, orchestrator execution model, model routing

Date: 2026-10-14 · Status: accepted

## Context

Phase 3 adds the agentic engine: an orchestrator that plans and executes
multi-step marketing work via typed tools, calling OpenRouter models. The spec
(§8) suggests pg-boss for the persistent job queue "por ejemplo" and forbids
Redis in the MVP. We also need a model-selection strategy and an execution
model that keeps long work out of HTTP requests.

## Decision 1 — the `agent_runs` table IS the queue (no pg-boss)

We do NOT add pg-boss. The worker claims work with a single atomic statement:

```sql
UPDATE agent_runs
SET status = 'running', claimed_by = $1, heartbeat_at = now(), attempts = attempts + 1
WHERE id = (
  SELECT id FROM agent_runs
  WHERE status = 'pending'
  ORDER BY created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED
)
RETURNING *;
```

Rationale:

- One less dependency and one less failure mode; the run state is already in
  Postgres and the SSE stream reads the same rows, so queue and observability
  cannot drift apart.
- `SKIP LOCKED` gives safe multi-worker concurrency for free.
- Crash recovery: the worker heartbeats `heartbeat_at` every 15 s; on startup it
  re-queues runs stuck in `planning`/`running` with a stale heartbeat (> 5 min)
  back to `pending` (attempts + 1, max 3 attempts, then `failed`).
- pg-boss remains a valid future upgrade if throughput ever demands it; the
  `apps/worker` claim loop is the only seam to replace.

## Decision 2 — orchestrator execution model

- The orchestrator (`@brandforge/agent-core`) is a pure state machine over the
  states in `packages/shared/src/agent.ts` (`RUN_STATES`, `RUN_TRANSITIONS`).
  `canTransition()` is the single gate; illegal transitions throw.
- One entry point for the worker: `orchestrator.executeRun(runId)` drives a
  claimed run from its current state to a terminal state (`completed`/`failed`/
  `cancelled`) or a parked state (`waiting_approval`). HTTP handlers only mutate
  rows (`startRun`/`cancelRun`/`resumeRun`/`approveRun`); they never run the loop.
- Planning is one LLM call (JSON mode, Zod-validated) producing an `AgentPlan`
  (max 25 steps, configurable). Unknown tools or invalid plans → one planning
  retry, then `failed` with a clear error.
- Steps execute in topological order; independent steps run in parallel
  (`Promise.allSettled` per level). Each step: timeout (default 120 s), max
  2 retries with backoff, then the run fails with the concrete error.
  Resume re-runs from the failed step — completed steps are never re-executed.
- Budget guard: before any `generate`-category step, the planner's estimate (or
  a per-tool estimate) is checked against the approved budget and the workspace
  credit balance. Exceeding it parks the run in `waiting_approval` with a
  reason + requested amount; the user approves (optionally raising the budget)
  or cancels. Expensive generations never start without a quota check.
- Idempotency: `agent_runs.idempotency_key` is unique per workspace (24 h
  window); re-POSTing the same key returns the existing run. Tool calls are
  idempotent on `(run_id, step_id, tool, args_hash)` — a retried step reuses the
  recorded result instead of re-executing.
- Events: every state/step/tool/usage transition appends to `agent_events`
  (`run_id, seq` unique). The SSE endpoint tails this table — simple, replayable,
  no pub/sub infrastructure.

## Decision 3 — model routing

- `ModelRouter` (`@brandforge/integrations`) selects per task kind
  (`text | vision | image | review | plan`), never assuming capabilities.
- Capability source, in order: (1) explicit env override
  (`OPENROUTER_TEXT_MODEL`, …); (2) a static registry of known models with
  verified capabilities; (3) a live `GET /models` check, cached 1 h.
  If no capable model is found, the router throws `NoCapableModelError` —
  the run fails honestly instead of calling the wrong model.
- Cost is recorded ONLY from provider data (`usage` tokens; `cost` field when
  OpenRouter returns it). Prices are never invented or hardcoded.

## Decision 4 — credits vs tokens

- Commercial credits (USD-denominated, in `credit_ledger`) are the product
  unit: `grant` (monthly plan allowance), `reserve` (pre-generation hold),
  `settle` (actual charge), `refund` (failed operation releases the hold).
- Raw model tokens live in `model_usage` and are never confused with credits.
- Demo workspaces: `ai_enabled = false`, 0 granted credits by default
  (configurable via `DEMO_AI_CREDITS`). Without `OPENROUTER_API_KEY` the API
  refuses to start runs with an honest `AI_NOT_CONFIGURED` error — nothing is
  faked.

## Consequences

- Worker, API and web all read the same Postgres tables; no Redis, no pg-boss.
- All Phase 3 limits (max steps, timeouts, budgets, quotas) are env-config,
  never hardcoded in the UI.
