/**
 * Orchestrator port implementations — the server side of the agent-core
 * contract (ADR-0006): event log, credit-backed budget, file storage,
 * conversation replies, and the DbMemoryStore.
 */
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { and, asc, eq, gt, sql } from 'drizzle-orm';
import { DbMemoryStore, type PortFactories } from '@brandforge/agent-core';
import type { AgentEventType } from '@brandforge/shared';
import {
  agentEvents,
  assets,
  messages,
  modelUsage,
  type AgentEventRow,
  type Db,
} from '@brandforge/database';
import { refundReservation, reserveCredits, settleReservation } from './ledger.js';
import type { BudgetPort, ConversationPort, MemoryStore, StoragePort } from './types.js';

// ---------------------------------------------------------------------------
// emit: append-only event log, seq = max+1 per run inside a transaction
// ---------------------------------------------------------------------------

export type EmitFn = (
  type: AgentEventType,
  payload: Record<string, unknown>,
) => Promise<AgentEventRow>;

export function makeEmit(db: Db): (runId: string) => EmitFn {
  return (runId: string) => async (type, payload) => {
    return db.transaction(async (tx) => {
      const [m] = await tx
        .select({ max: sql<number | null>`max(${agentEvents.seq})` })
        .from(agentEvents)
        .where(eq(agentEvents.runId, runId));
      const seq = (m?.max ?? -1) + 1;
      const [row] = await tx
        .insert(agentEvents)
        .values({ runId, seq, type, payload })
        .returning();
      return row;
    });
  };
}

// ---------------------------------------------------------------------------
// budget: credit-backed. checkAffordable places a hold; recordUsage settles
// the hold against the actual provider cost; abort() releases a pending hold.
// A stale pending hold (previous step failed before settling) is refunded
// before placing a new one, so holds can never stack up.
// ---------------------------------------------------------------------------

export function makeBudget(db: Db, workspaceId: string, runId: string): BudgetPort {
  let pendingReserveEntryId: string | null = null;

  const releasePending = async (): Promise<void> => {
    if (!pendingReserveEntryId) return;
    const entryId = pendingReserveEntryId;
    pendingReserveEntryId = null;
    await refundReservation(db, workspaceId, entryId).catch(() => undefined);
  };

  return {
    async checkAffordable(estimatedUsd: number) {
      // Defensive: a previous generate step may have failed after its
      // reserve but before recordUsage — release that stale hold first.
      await releasePending();
      const res = await reserveCredits(db, workspaceId, estimatedUsd, 'agent_run', runId);
      if (!res.ok) return { ok: false, reason: res.reason };
      pendingReserveEntryId = res.entryId ?? null;
      return { ok: true };
    },

    async recordUsage(u) {
      await db.insert(modelUsage).values({
        runId,
        model: u.model,
        tool: u.tool,
        tokensIn: u.tokensIn,
        tokensOut: u.tokensOut,
        costUsd: u.costUsd != null ? String(u.costUsd) : null,
        durationMs: u.durationMs,
      });
      if (pendingReserveEntryId) {
        const entryId = pendingReserveEntryId;
        pendingReserveEntryId = null;
        // Never fail usage recording because of a ledger hiccup — the hold
        // stays on the books and the worker's post-run reconciliation
        // releases it; the usage row is the source of truth for tokens.
        await settleReservation(db, workspaceId, entryId, u.costUsd ?? 0).catch(() => undefined);
      }
    },

    async abort() {
      await releasePending();
    },
  };
}

// ---------------------------------------------------------------------------
// storage: generated files land under STORAGE_PATH/<workspaceId>/
// ---------------------------------------------------------------------------

const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'text/html': 'html',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'application/json': 'json',
};

export function extForMime(mimeType: string): string {
  return MIME_EXT[mimeType.toLowerCase()] ?? 'bin';
}

export function makeStorage(db: Db, workspaceId: string, storagePath: string): StoragePort {
  return {
    async saveFile(input) {
      const filename = `${randomUUID()}.${extForMime(input.mimeType)}`;
      const dir = path.join(storagePath, workspaceId);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, filename), input.data);
      const [row] = await db
        .insert(assets)
        .values({
          workspaceId,
          filename,
          originalName: input.name,
          mime: input.mimeType,
          sizeBytes: input.data.length,
          kind: input.kind,
          width: input.width ?? null,
          height: input.height ?? null,
        })
        .returning({ id: assets.id });
      return { assetId: row.id, url: `/api/v1/assets/${row.id}` };
    },
  };
}

// ---------------------------------------------------------------------------
// conversation: the run's final answer becomes an assistant message
// ---------------------------------------------------------------------------

export function makeConversation(db: Db): ConversationPort {
  return {
    async appendAssistantMessage(conversationId, content, meta) {
      await db.insert(messages).values({
        conversationId,
        role: 'assistant',
        content,
        meta: meta ?? {},
      });
    },
  };
}

// ---------------------------------------------------------------------------
// memory: agent-core's DbMemoryStore over the agent_memories table
// ---------------------------------------------------------------------------

export function makeMemory(db: Db): MemoryStore {
  return new DbMemoryStore(db);
}

/** Latest events for a run (used by the SSE endpoint). */
export async function listEventsAfter(
  db: Db,
  runId: string,
  afterSeq: number,
  limit = 200,
): Promise<AgentEventRow[]> {
  return db
    .select()
    .from(agentEvents)
    .where(and(eq(agentEvents.runId, runId), gt(agentEvents.seq, afterSeq)))
    .orderBy(asc(agentEvents.seq))
    .limit(limit);
}

export type { PortFactories };
