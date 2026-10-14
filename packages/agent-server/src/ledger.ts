/**
 * Commercial credit ledger (spec §17, ADR-0006 decision 4).
 *
 * Credits are the product unit, USD-denominated, stored as NUMERIC(2dp).
 * Kinds: grant (monthly plan allowance), reserve (pre-generation hold),
 * settle (actual charge — releases the unused part of a hold), refund
 * (full release of a hold when the operation fails).
 *
 * Raw model tokens live in `model_usage` and are NEVER confused with credits.
 * All money math is done in integer cents to avoid float drift.
 * Nested calls reuse the outer transaction via savepoints (drizzle supports
 * tx-in-tx), so every function can simply wrap in `db.transaction(...)`.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { creditLedger, usageQuotas, type Db } from '@brandforge/database';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbOrTx = Db | Tx;

export type LedgerKind = 'grant' | 'reserve' | 'settle' | 'refund';

export interface ReserveResult {
  ok: boolean;
  reason?: string;
  entryId?: string;
  balanceAfter?: string;
}

/** USD (number|string) → integer cents. */
export function toCents(usd: number | string): number {
  return Math.round(Number(usd) * 100);
}

/** Integer cents → '0.00' string for NUMERIC columns. */
export function toUsd(cents: number): string {
  return (cents / 100).toFixed(2);
}

async function readBalanceCents(tx: DbOrTx, workspaceId: string): Promise<number> {
  const [q] = await tx
    .select({ balance: usageQuotas.creditsBalance })
    .from(usageQuotas)
    .where(eq(usageQuotas.workspaceId, workspaceId))
    .limit(1)
    .for('update');
  return toCents(q?.balance ?? '0');
}

/** Defensive: a ledger write always needs a quota row to hold the balance. */
async function ensureQuotaRow(tx: DbOrTx, workspaceId: string): Promise<void> {
  await tx
    .insert(usageQuotas)
    .values({ workspaceId, plan: 'free', creditsBalance: '0' })
    .onConflictDoNothing({ target: usageQuotas.workspaceId });
}

async function appendEntry(
  tx: DbOrTx,
  workspaceId: string,
  kind: LedgerKind,
  deltaCents: number,
  refType: string,
  refId: string | null,
  reservationId: string | null = null,
): Promise<{ entryId: string; balanceAfter: string }> {
  await ensureQuotaRow(tx, workspaceId);
  const balance = await readBalanceCents(tx, workspaceId);
  const after = balance + deltaCents;
  const [entry] = await tx
    .insert(creditLedger)
    .values({
      workspaceId,
      delta: toUsd(deltaCents),
      kind,
      refType,
      refId,
      reservationId,
      balanceAfter: toUsd(after),
    })
    .returning({ id: creditLedger.id });
  await tx
    .update(usageQuotas)
    .set({ creditsBalance: toUsd(after), updatedAt: new Date() })
    .where(eq(usageQuotas.workspaceId, workspaceId));
  return { entryId: entry.id, balanceAfter: toUsd(after) };
}

/** Credit a workspace (e.g. the monthly plan allowance). Always succeeds. */
export async function grantCredits(
  db: DbOrTx,
  workspaceId: string,
  amountUsd: number,
  refType: string,
  refId?: string,
): Promise<{ entryId: string; balanceAfter: string }> {
  return db.transaction((tx) =>
    appendEntry(tx, workspaceId, 'grant', toCents(amountUsd), refType, refId ?? null),
  );
}

/**
 * Place a hold of `amountUsd` on the workspace balance. Fails honestly when
 * the balance is insufficient — the caller (budget port) parks the run for
 * approval instead of spending money that isn't there.
 */
export async function reserveCredits(
  db: DbOrTx,
  workspaceId: string,
  amountUsd: number,
  refType: string,
  refId?: string,
): Promise<ReserveResult> {
  return db.transaction(async (tx): Promise<ReserveResult> => {
    await ensureQuotaRow(tx, workspaceId);
    const balance = await readBalanceCents(tx, workspaceId);
    const amount = toCents(amountUsd);
    if (balance < amount) return { ok: false, reason: 'INSUFFICIENT_CREDITS' };
    const after = balance - amount;
    const [entry] = await tx
      .insert(creditLedger)
      .values({
        workspaceId,
        delta: toUsd(-amount),
        kind: 'reserve',
        refType,
        refId: refId ?? null,
        balanceAfter: toUsd(after),
      })
      .returning({ id: creditLedger.id });
    await tx
      .update(usageQuotas)
      .set({ creditsBalance: toUsd(after), updatedAt: new Date() })
      .where(eq(usageQuotas.workspaceId, workspaceId));
    return { ok: true, entryId: entry.id, balanceAfter: toUsd(after) };
  });
}

async function findReserve(
  tx: DbOrTx,
  workspaceId: string,
  reserveEntryId: string,
): Promise<{ refType: string; refId: string | null; reservedCents: number }> {
  const [reserve] = await tx
    .select()
    .from(creditLedger)
    .where(and(eq(creditLedger.id, reserveEntryId), eq(creditLedger.kind, 'reserve')))
    .limit(1)
    .for('update');
  if (!reserve || reserve.workspaceId !== workspaceId) {
    throw new Error(`reserve entry not found: ${reserveEntryId}`);
  }
  return { refType: reserve.refType, refId: reserve.refId, reservedCents: -toCents(reserve.delta) };
}

/**
 * Settle a reservation against the ACTUAL cost. If actual < reserved, the
 * difference goes back to the balance as a partial release; if actual >
 * reserved (estimate was low), the extra is charged. Returns the settle entry.
 */
export async function settleReservation(
  db: DbOrTx,
  workspaceId: string,
  reserveEntryId: string,
  actualUsd: number,
): Promise<{ entryId: string; balanceAfter: string }> {
  return db.transaction(async (tx) => {
    const { refType, refId, reservedCents } = await findReserve(tx, workspaceId, reserveEntryId);
    const [alreadyClosed] = await tx
      .select({ id: creditLedger.id, balanceAfter: creditLedger.balanceAfter })
      .from(creditLedger)
      .where(eq(creditLedger.reservationId, reserveEntryId))
      .limit(1);
    if (alreadyClosed) return { entryId: alreadyClosed.id, balanceAfter: alreadyClosed.balanceAfter };
    const diffCents = reservedCents - toCents(actualUsd); // +refund / -extra charge / 0
    return appendEntry(tx, workspaceId, 'settle', diffCents, refType, refId, reserveEntryId);
  });
}

/** Release a hold in full (operation failed or was cancelled). */
export async function refundReservation(
  db: DbOrTx,
  workspaceId: string,
  reserveEntryId: string,
): Promise<{ entryId: string; balanceAfter: string }> {
  return db.transaction(async (tx) => {
    const { refType, refId, reservedCents } = await findReserve(tx, workspaceId, reserveEntryId);
    const [alreadyClosed] = await tx
      .select({ id: creditLedger.id, balanceAfter: creditLedger.balanceAfter })
      .from(creditLedger)
      .where(eq(creditLedger.reservationId, reserveEntryId))
      .limit(1);
    if (alreadyClosed) return { entryId: alreadyClosed.id, balanceAfter: alreadyClosed.balanceAfter };
    return appendEntry(tx, workspaceId, 'refund', reservedCents, refType, refId, reserveEntryId);
  });
}

/**
 * Post-run reconciliation: refund any 'agent_run' holds for this run that
 * were never settled. The orchestrator only settles on the success path
 * (recordUsage); a generate step that throws after its reserve leaks the
 * hold otherwise. Settlement is strictly FIFO in the budget port, so any
 * reserve beyond the settlement count is, by construction, unsettled.
 *
 * Safe to call on every run end (no-op when everything settled).
 */
export async function reconcileRunLedger(
  db: DbOrTx,
  runId: string,
): Promise<{ refunded: number }> {
  return db.transaction(async (tx) => {
    const runRef = and(eq(creditLedger.refType, 'agent_run'), eq(creditLedger.refId, runId));
    const reserves = await tx
      .select()
      .from(creditLedger)
      .where(and(eq(creditLedger.kind, 'reserve'), runRef))
      .orderBy(creditLedger.createdAt);
    if (reserves.length === 0) return { refunded: 0 };
    const settlements = await tx
      .select({ reservationId: creditLedger.reservationId })
      .from(creditLedger)
      .where(and(inArray(creditLedger.kind, ['settle', 'refund']), runRef));
    const closed = new Set(settlements.flatMap((entry) => entry.reservationId ? [entry.reservationId] : []));
    // Entries written before reservation_id existed can only be paired FIFO.
    let legacyClosures = settlements.filter((entry) => !entry.reservationId).length;
    let refunded = 0;
    for (const reserve of reserves) {
      if (closed.has(reserve.id)) continue;
      if (legacyClosures > 0) {
        legacyClosures -= 1;
        continue;
      }
      await refundReservation(tx, reserve.workspaceId, reserve.id);
      refunded += 1;
    }
    return { refunded };
  });
}
