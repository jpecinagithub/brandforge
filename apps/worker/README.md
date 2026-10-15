# @brandforge/worker

Background job runner for durable agent execution (ADR-0006).

`src/index.ts` runs the claim loop:

- On startup it re-queues runs stuck in `planning`/`running` with a stale
  heartbeat (> 5 min) back to `pending` (`attempts` + 1; after 3 attempts the
  run is marked `failed`).
- Every 2 s it claims one `pending` run with
  `UPDATE ... WHERE id = (SELECT ... FOR UPDATE SKIP LOCKED)`, heartbeats
  every 15 s, and drives it with `orchestrator.executeRun(runId)`.
- SIGTERM/SIGINT shut the loop down gracefully.

The `worker` service in `infrastructure/docker/docker-compose.yml` runs this
image by default (no profile). Local dev: `npm run dev --workspace=@brandforge/worker`.
