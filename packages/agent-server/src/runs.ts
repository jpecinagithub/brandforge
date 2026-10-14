/**
 * HTTP-facing run handles. Thin delegates to the Orchestrator built by
 * buildOrchestrator — the state machine itself lives in @brandforge/agent-core
 * (ADR-0006: HTTP handlers only mutate rows, they never run the loop).
 *
 * A process-level cache avoids rebuilding the orchestrator (and its model
 * router cache) on every request; the db handle and storage path are stable
 * per process.
 */
import type { Orchestrator, StartRunParams } from '@brandforge/agent-core';
import type { Db } from '@brandforge/database';
import { buildOrchestrator } from './factory.js';

export type { StartRunParams };

let cached: { key: string; orchestrator: Orchestrator } | null = null;

export function getOrchestrator(db: Db, storagePath: string): Orchestrator {
  if (!cached || cached.key !== storagePath) {
    cached = { key: storagePath, orchestrator: buildOrchestrator(db, { storagePath }) };
  }
  return cached.orchestrator;
}

/** For tests: drop the cached orchestrator so overrides take effect. */
export function resetOrchestratorCache(): void {
  cached = null;
}

export async function startAgentRun(
  db: Db,
  storagePath: string,
  params: StartRunParams,
): Promise<{ id: string; state: string; deduped: boolean }> {
  const res = await getOrchestrator(db, storagePath).startRun(params);
  return { id: res.id, state: res.state, deduped: res.deduped };
}

export async function cancelAgentRun(db: Db, storagePath: string, runId: string): Promise<void> {
  await getOrchestrator(db, storagePath).cancelRun(runId);
}

export async function resumeAgentRun(db: Db, storagePath: string, runId: string): Promise<void> {
  await getOrchestrator(db, storagePath).resumeRun(runId);
}

export async function approveAgentRun(
  db: Db,
  storagePath: string,
  runId: string,
  approved: boolean,
  budgetUsd?: number,
): Promise<void> {
  await getOrchestrator(db, storagePath).approveRun(runId, approved, budgetUsd);
}

/** For tests that need the TEST-ONLY overrides (fake provider client). */
export function buildTestOrchestrator(
  db: Db,
  storagePath: string,
  overrides: NonNullable<Parameters<typeof buildOrchestrator>[1]['overrides']>,
): Orchestrator {
  return buildOrchestrator(db, { storagePath, overrides });
}
