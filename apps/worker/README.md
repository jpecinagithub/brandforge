# @brandforge/worker

Background job runner — **Phase 5 stub**.

`src/index.ts` currently logs a notice and exits 0.

## Plan (Phase 5)

- Job queue: **pg-boss on Postgres** — no Redis per project spec.
- First jobs: `cleanup-demos` (expired demo accounts), email retries,
  Phase-3 agent run execution.
- The `worker` service in `infrastructure/docker/docker-compose.yml` is
  commented out until Phase 5.
