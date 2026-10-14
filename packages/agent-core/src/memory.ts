/**
 * DbMemoryStore — MemoryStore backed by the agent_memories table.
 * Upserts on (scope, ownerId, key); project scope is keyed by projectId,
 * user scope by userId. Only summaries/values are sent to models, never
 * full histories (spec §11).
 */
import { and, eq } from 'drizzle-orm';
import { agentMemories, type Db } from '@brandforge/database';
import type { MemoryStore } from './types.js';

export class DbMemoryStore implements MemoryStore {
  constructor(private readonly db: Db) {}

  async getProjectMemory(projectId: string): Promise<Record<string, unknown>> {
    return this.getAll('project', projectId);
  }

  async setProjectMemory(
    projectId: string,
    key: string,
    value: unknown,
    summary?: string,
  ): Promise<void> {
    await this.upsert('project', projectId, key, value, summary);
  }

  async getUserMemory(userId: string): Promise<Record<string, unknown>> {
    return this.getAll('user', userId);
  }

  async setUserMemory(
    userId: string,
    key: string,
    value: unknown,
  ): Promise<void> {
    await this.upsert('user', userId, key, value, undefined);
  }

  private async getAll(
    scope: string,
    ownerId: string,
  ): Promise<Record<string, unknown>> {
    const rows = await this.db
      .select()
      .from(agentMemories)
      .where(
        and(eq(agentMemories.scope, scope), eq(agentMemories.ownerId, ownerId)),
      );
    const out: Record<string, unknown> = {};
    for (const row of rows) {
      out[row.key] = row.value;
    }
    return out;
  }

  private async upsert(
    scope: string,
    ownerId: string,
    key: string,
    value: unknown,
    summary: string | undefined,
  ): Promise<void> {
    await this.db
      .insert(agentMemories)
      .values({
        scope,
        ownerId,
        key,
        value: value as Record<string, unknown>,
        summary: summary ?? null,
      })
      .onConflictDoUpdate({
        target: [agentMemories.scope, agentMemories.ownerId, agentMemories.key],
        set: {
          value: value as Record<string, unknown>,
          summary: summary ?? null,
          updatedAt: new Date(),
        },
      });
  }
}
