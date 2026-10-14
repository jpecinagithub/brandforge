/**
 * Workspace AI quotas: monthly generation limits + credit balance gate.
 *
 * - `ensureQuota` upserts the workspace row with per-plan defaults and, on
 *   first creation or month rollover, grants the plan's monthly credits and
 *   resets the generation counter.
 * - `checkAiAllowed` is the honest gate used before starting any run.
 * - `incrementGenerations` counts a started run against the monthly limit.
 */
import { eq, sql } from 'drizzle-orm';
import { usageQuotas, workspaces, type Db } from '@brandforge/database';
import type { QuotaStatus } from '@brandforge/shared';
import { grantCredits, toCents, type DbOrTx } from './ledger.js';
import { readQuotaPlanDefaults } from './env.js';

export type PlanName = 'demo' | 'free' | 'pro';

export function currentPeriodMonth(d: Date = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function toQuotaStatus(row: typeof usageQuotas.$inferSelect): QuotaStatus {
  return {
    plan: row.plan,
    creditsBalance: row.creditsBalance,
    aiGenerationsUsed: row.aiGenerationsUsed,
    aiGenerationsLimit: row.aiGenerationsLimit,
    aiEnabled: row.aiEnabled,
  };
}

/**
 * Create or refresh the quota row for a workspace. Grants the monthly
 * credit allowance on creation and on month rollover; never double-grants
 * within the same period.
 */
export async function ensureQuota(
  db: DbOrTx,
  workspaceId: string,
  plan: PlanName,
): Promise<QuotaStatus> {
  const defaults = readQuotaPlanDefaults()[plan];
  const month = currentPeriodMonth();
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(usageQuotas)
      .where(eq(usageQuotas.workspaceId, workspaceId))
      .limit(1)
      .for('update');

    let grant = false;
    if (!existing) {
      await tx.insert(usageQuotas).values({
        workspaceId,
        plan,
        aiEnabled: defaults.aiEnabled,
        aiGenerationsLimit: defaults.generationsLimit,
        aiGenerationsUsed: 0,
        periodMonth: month,
        creditsBalance: '0',
      });
      grant = defaults.monthlyCreditsUsd > 0;
    } else {
      const rolledOver = existing.periodMonth !== month;
      await tx
        .update(usageQuotas)
        .set({
          plan,
          aiEnabled: defaults.aiEnabled,
          aiGenerationsLimit: defaults.generationsLimit,
          aiGenerationsUsed: rolledOver ? 0 : existing.aiGenerationsUsed,
          periodMonth: rolledOver ? month : existing.periodMonth,
          updatedAt: new Date(),
        })
        .where(eq(usageQuotas.workspaceId, workspaceId));
      grant = rolledOver && defaults.monthlyCreditsUsd > 0;
    }
    if (grant) {
      await grantCredits(tx, workspaceId, defaults.monthlyCreditsUsd, 'monthly_grant');
    }
    const [row] = await tx
      .select()
      .from(usageQuotas)
      .where(eq(usageQuotas.workspaceId, workspaceId))
      .limit(1);
    return toQuotaStatus(row);
  });
}

export interface AiAllowed {
  ok: boolean;
  reason?: 'NO_QUOTA' | 'AI_DISABLED' | 'GENERATIONS_LIMIT_REACHED' | 'INSUFFICIENT_CREDITS';
}

/** Honest gate: AI on for the plan, generations left this month, credits left. */
export async function checkAiAllowed(db: DbOrTx, workspaceId: string): Promise<AiAllowed> {
  const [row] = await db
    .select()
    .from(usageQuotas)
    .where(eq(usageQuotas.workspaceId, workspaceId))
    .limit(1);
  if (!row) return { ok: false, reason: 'NO_QUOTA' };
  if (!row.aiEnabled) return { ok: false, reason: 'AI_DISABLED' };
  if (row.aiGenerationsUsed >= row.aiGenerationsLimit) {
    return { ok: false, reason: 'GENERATIONS_LIMIT_REACHED' };
  }
  if (toCents(row.creditsBalance) <= 0) return { ok: false, reason: 'INSUFFICIENT_CREDITS' };
  return { ok: true };
}

/** Count one started run against the workspace's monthly generation limit. */
export async function incrementGenerations(db: DbOrTx, workspaceId: string): Promise<void> {
  await db
    .update(usageQuotas)
    .set({
      aiGenerationsUsed: sql`${usageQuotas.aiGenerationsUsed} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(usageQuotas.workspaceId, workspaceId));
}

/** Read the current quota status (null when the workspace was never set up). */
export async function getQuotaStatus(
  db: DbOrTx,
  workspaceId: string,
): Promise<QuotaStatus | null> {
  const [row] = await db
    .select()
    .from(usageQuotas)
    .where(eq(usageQuotas.workspaceId, workspaceId))
    .limit(1);
  return row ? toQuotaStatus(row) : null;
}

/**
 * Ensure the quota row exists with the right plan: preserve an explicitly
 * set plan, otherwise default demo workspaces to 'demo' and the rest to
 * 'free'. Shared by the agent routes and the chat endpoint.
 */
export async function ensureWorkspaceQuota(
  db: DbOrTx,
  workspaceId: string,
): Promise<QuotaStatus> {
  const existing = await getQuotaStatus(db, workspaceId);
  let plan: PlanName = 'free';
  if (existing && (existing.plan === 'demo' || existing.plan === 'free' || existing.plan === 'pro')) {
    plan = existing.plan;
  } else {
    const [ws] = await db
      .select({ isDemo: workspaces.isDemo })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1);
    plan = ws?.isDemo ? 'demo' : 'free';
  }
  return ensureQuota(db, workspaceId, plan);
}

// Re-export Db for consumers.
export type { Db };
