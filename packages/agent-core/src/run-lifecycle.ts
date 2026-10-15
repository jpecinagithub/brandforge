import { and, eq } from 'drizzle-orm';
import { agentSteps, type Db } from '@brandforge/database';

/**
 * Keep persisted step state consistent when a run reaches a terminal state
 * outside the normal tool-completion path (cancel, crash recovery, etc.).
 * Completed/failed steps are intentionally left untouched so a resumed run
 * can reuse completed work and retry only unfinished work.
 */
export async function closeRunningAgentSteps(
  db: Db,
  runId: string,
  status: 'failed' | 'cancelled',
  error: string | null,
): Promise<number> {
  const now = new Date();
  const rows = await db
    .update(agentSteps)
    .set({ status, error, finishedAt: now, updatedAt: now })
    .where(and(eq(agentSteps.runId, runId), eq(agentSteps.status, 'running')))
    .returning({ id: agentSteps.id });
  return rows.length;
}
