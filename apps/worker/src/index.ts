/**
 * BrandForge background worker — durable agent run executor.
 *
 * The `agent_runs` table IS the queue (ADR-0006): the worker claims pending
 * runs with SELECT ... FOR UPDATE SKIP LOCKED, heartbeats every 15 s, and
 * re-queues crashed runs (stale heartbeat > 5 min) on startup.
 *
 * One entry point into the engine: orchestrator.executeRun(runId).
 *
 * NOTE on status handling (deliberate deviation from the ADR-0006 sketch):
 * the claim does NOT set status='running'. Orchestrator.executeRun drives
 * pending→planning→running itself; pre-setting 'running' would skip planning
 * and fail every fresh run ("Stored plan is invalid"). Likewise, a stale
 * 'running' run keeps its status on requeue so executeRun resumes from the
 * existing plan (completed steps are skipped, never re-executed).
 */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { and, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { agentRuns, agentSteps, createClient, createDb, type Db } from '@brandforge/database';
import { closeRunningAgentSteps } from '@brandforge/agent-core';
import { buildOrchestrator, makeEmit, readAgentConfig, reconcileRunLedger } from '@brandforge/agent-server';
import { recoveryTarget } from './recovery.js';

const WORKER_ID = `worker-${hostname()}-${process.pid}-${randomUUID().slice(0, 8)}`;
const POLL_MS = 2000;
const HEARTBEAT_MS = 15_000;
const STALE_HEARTBEAT_MS = 5 * 60_000;
const RECOVERY_SWEEP_MS = 60_000;
const SHUTDOWN_GRACE_MS = 7_000;

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('Missing required env var: DATABASE_URL');
  process.exit(1);
}
const storagePath = process.env.STORAGE_PATH ?? './storage';
const agentConfig = readAgentConfig();

const raw = createClient(databaseUrl);
const db: Db = createDb(raw);

let shuttingDown = false;
let shutdownStarted = false;
let activeRunId: string | null = null;
let activeRunPromise: Promise<void> | null = null;
let lastRecoverySweep = 0;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function recoveryMessage(language: 'en' | 'es'): string {
  return language === 'es'
    ? 'La ejecución se está recuperando automáticamente. Los pasos completados no se repetirán.'
    : 'The run is recovering automatically. Completed steps will not be repeated.';
}

function stoppedMessage(language: 'en' | 'es'): string {
  return language === 'es'
    ? 'La ejecución se detuvo de forma segura tras varios intentos. Todos los resultados creados se han conservado.'
    : 'The run stopped safely after several attempts. All created results have been preserved.';
}

async function recoverInterruptedRun(runId: string, internalReason: string): Promise<void> {
  const [run] = await db.select().from(agentRuns).where(eq(agentRuns.id, runId)).limit(1);
  if (!run) return;
  const target = recoveryTarget(run.status, run.attempts, agentConfig.maxAttempts);
  if (!target) return;
  const language = (run.plan as { language?: unknown } | null)?.language === 'es' ? 'es' : 'en';
  const emit = makeEmit(db)(runId);

  if (target === 'failed') {
    const message = stoppedMessage(language);
    await closeRunningAgentSteps(db, runId, 'failed', message);
    const [failed] = await db
      .update(agentRuns)
      .set({
        status: 'failed',
        claimedBy: null,
        heartbeatAt: null,
        error: message,
        finishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(agentRuns.id, runId), inArray(agentRuns.status, ['planning', 'running'])))
      .returning({ id: agentRuns.id });
    if (failed) {
      await emit('run.state', { from: run.status, to: 'failed' });
      await emit('run.finished', { status: 'failed', error: message });
    }
    console.error(`[worker] run ${runId} exhausted recovery attempts: ${internalReason}`);
    return;
  }

  await db
    .update(agentRuns)
    .set({ status: target, claimedBy: null, heartbeatAt: null, updatedAt: new Date() })
    .where(and(eq(agentRuns.id, runId), inArray(agentRuns.status, ['planning', 'running'])));
  await db
    .update(agentSteps)
    .set({ status: 'pending', error: null, finishedAt: null, updatedAt: new Date() })
    .where(and(eq(agentSteps.runId, runId), eq(agentSteps.status, 'running')));
  await emit('run.recovering', {
    state: target,
    attempt: run.attempts,
    maxAttempts: agentConfig.maxAttempts,
    message: recoveryMessage(language),
  });
  console.error(`[worker] run ${runId} released for recovery: ${internalReason}`);
}

/**
 * Crash recovery (startup): runs stuck in planning/running with a stale
 * heartbeat are released for re-claim. A stale 'planning' run goes back to
 * 'pending' (planning never completed); a stale 'running' run KEEPS its
 * status so executeRun resumes from the existing plan. Past the attempt
 * budget the run is marked failed.
 */
async function requeueStale(): Promise<void> {
  const staleBefore = new Date(Date.now() - STALE_HEARTBEAT_MS);
  const stale = and(
    inArray(agentRuns.status, ['planning', 'running']),
    or(isNull(agentRuns.heartbeatAt), lt(agentRuns.heartbeatAt, staleBefore)),
  );

  const revivedPlanning = await db
    .update(agentRuns)
    .set({
      status: 'pending',
      claimedBy: null,
      heartbeatAt: null,
      updatedAt: new Date(),
    })
    .where(and(stale, eq(agentRuns.status, 'planning'), lt(agentRuns.attempts, agentConfig.maxAttempts)))
    .returning({ id: agentRuns.id, plan: agentRuns.plan });

  const revivedRunning = await db
    .update(agentRuns)
    .set({
      claimedBy: null,
      heartbeatAt: null,
      updatedAt: new Date(),
    })
    .where(and(stale, eq(agentRuns.status, 'running'), lt(agentRuns.attempts, agentConfig.maxAttempts)))
    .returning({ id: agentRuns.id, plan: agentRuns.plan });

  const dead = await db
    .update(agentRuns)
    .set({
      status: 'failed',
      claimedBy: null,
      heartbeatAt: null,
      error: 'The run stopped safely and all created results have been preserved.',
      finishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(stale, sql`${agentRuns.attempts} >= ${agentConfig.maxAttempts}`))
    .returning({ id: agentRuns.id, plan: agentRuns.plan });

  const revived = [...revivedPlanning, ...revivedRunning];
  const emit = makeEmit(db);
  for (const run of revived) {
    const language = (run.plan as { language?: unknown } | null)?.language === 'es' ? 'es' : 'en';
    await emit(run.id)('run.recovering', {
      message: recoveryMessage(language),
    });
  }
  for (const run of dead) {
    const language = (run.plan as { language?: unknown } | null)?.language === 'es' ? 'es' : 'en';
    const message = stoppedMessage(language);
    await db.update(agentRuns).set({ error: message, updatedAt: new Date() }).where(eq(agentRuns.id, run.id));
    await closeRunningAgentSteps(
      db,
      run.id,
      'failed',
      message,
    );
    await emit(run.id)('run.finished', {
      status: 'failed',
      error: message,
    });
  }
  if (revived.length > 0 || dead.length > 0) {
    console.log(`[worker] requeue: ${revived.length} released for re-claim, ${dead.length} marked failed`);
  }
}

/**
 * Claim one run: the oldest 'pending' run, or a 'running' run whose claim
 * was released (crashed worker, already requeued above). The status column
 * is left for the orchestrator to drive — only the claim is taken.
 */
async function claimRun(): Promise<string | null> {
  const rows = await db.execute<{ id: string }>(sql`
    UPDATE agent_runs
    SET claimed_by = ${WORKER_ID},
        heartbeat_at = now(),
        attempts = attempts + 1,
        started_at = COALESCE(started_at, now()),
        updated_at = now()
    WHERE id = (
      SELECT id FROM agent_runs
      WHERE (status = 'pending'
         OR (status = 'running' AND claimed_by IS NULL))
        AND attempts < ${agentConfig.maxAttempts}
      ORDER BY created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id
  `);
  return rows.length > 0 ? rows[0].id : null;
}

function startHeartbeat(runId: string): NodeJS.Timeout {
  return setInterval(() => {
    db.update(agentRuns)
      .set({ heartbeatAt: new Date(), updatedAt: new Date() })
      .where(and(eq(agentRuns.id, runId), eq(agentRuns.claimedBy, WORKER_ID)))
      .catch((err) => console.error(`[worker] heartbeat failed for ${runId}:`, err));
  }, HEARTBEAT_MS);
}

async function processOne(runId: string): Promise<void> {
  const heartbeat = startHeartbeat(runId);
  try {
    console.log(`[worker] executing run ${runId}`);
    const orchestrator = buildOrchestrator(db, { storagePath });
    await orchestrator.executeRun(runId);
    console.log(`[worker] run ${runId} finished`);
  } catch (err) {
    console.error(`[worker] run ${runId} crashed:`, err);
    await recoverInterruptedRun(runId, err instanceof Error ? err.message : String(err)).catch((recoveryError) => {
      console.error(`[worker] recovery failed for ${runId}:`, recoveryError);
    });
  } finally {
    clearInterval(heartbeat);
    // Release the claim so a requeue can pick the run up if needed.
    await db
      .update(agentRuns)
      .set({ claimedBy: null, updatedAt: new Date() })
      .where(and(eq(agentRuns.id, runId), eq(agentRuns.claimedBy, WORKER_ID)))
      .catch((err) => console.error(`[worker] claim release failed for ${runId}:`, err));
    // Second line of defense for credit holds: refund any reserve the
    // budget port placed but never settled (e.g. a generate step threw
    // after its hold). No-op when everything settled.
    try {
      const { refunded } = await reconcileRunLedger(db, runId);
      if (refunded > 0) console.log(`[worker] run ${runId}: refunded ${refunded} unsettled hold(s)`);
    } catch (err) {
      console.error(`[worker] ledger reconciliation failed for ${runId}:`, err);
    }
  }
}

async function loop(): Promise<void> {
  while (!shuttingDown) {
    try {
      if (Date.now() - lastRecoverySweep >= RECOVERY_SWEEP_MS) {
        await requeueStale();
        lastRecoverySweep = Date.now();
      }
      const runId = await claimRun();
      if (runId) {
        activeRunId = runId;
        activeRunPromise = processOne(runId);
        await activeRunPromise;
        activeRunId = null;
        activeRunPromise = null;
        continue; // immediately look for more work
      }
    } catch (err) {
      console.error('[worker] claim loop error:', err);
    }
    await wait(POLL_MS);
  }
}

async function shutdown(signal: string): Promise<void> {
  if (shutdownStarted) return;
  shutdownStarted = true;
  shuttingDown = true;
  console.log(`[worker] received ${signal}, shutting down…`);
  try {
    if (activeRunPromise) {
      await Promise.race([activeRunPromise, wait(SHUTDOWN_GRACE_MS)]);
    }
    if (activeRunId) {
      await recoverInterruptedRun(activeRunId, `worker received ${signal}`);
    }
    await raw.end();
  } catch {
    // best effort
  }
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

async function main(): Promise<void> {
  console.log(`[worker] starting (${WORKER_ID})`);
  await requeueStale();
  lastRecoverySweep = Date.now();
  await loop();
}

main().catch((err) => {
  console.error('[worker] fatal:', err);
  process.exit(1);
});
