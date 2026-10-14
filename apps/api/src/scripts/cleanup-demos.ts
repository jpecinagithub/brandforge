/**
 * Delete expired demo accounts: `npm run cleanup-demos`
 *
 * Removes users with is_demo=true and demo_expires_at < now (FK cascades
 * wipe sessions, tokens and workspace memberships), then deletes demo
 * workspaces left with no members, and removes their files from storage.
 *
 * Reads DATABASE_URL and STORAGE_PATH from the environment.
 *
 * FUTURE: run this on a cron (e.g. daily) via the Phase 5 worker.
 */
import 'dotenv/config';
import { and, eq, lt, notInArray } from 'drizzle-orm';
import { createClient, createDb, type Db } from '../db.js';
import {
  assets,
  users,
  workspaceMembers,
  workspaces,
} from '@brandforge/database';
import { LocalDiskStorage } from '../storage.js';

async function filesForWorkspace(db: Db, workspaceId: string): Promise<string[]> {
  const rows = await db
    .select({ filename: assets.filename })
    .from(assets)
    .where(eq(assets.workspaceId, workspaceId));
  return rows.map((r) => (r.filename.includes('/') ? r.filename : `assets/${r.filename}`));
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set');
  const storage = new LocalDiskStorage(process.env.STORAGE_PATH ?? './storage');
  const client = createClient(databaseUrl);
  const db = createDb(client);
  try {
    const now = new Date();
    const expired = await db
      .select({ id: users.id, avatarPath: users.avatarPath })
      .from(users)
      .where(and(eq(users.isDemo, true), lt(users.demoExpiresAt, now)));

    let usersRemoved = 0;
    for (const u of expired) {
      if (u.avatarPath) await storage.remove(u.avatarPath);
      await db.delete(users).where(eq(users.id, u.id));
      usersRemoved += 1;
    }

    // Demo workspaces with no members left → remove files + rows
    const membered = db
      .select({ workspaceId: workspaceMembers.workspaceId })
      .from(workspaceMembers)
      .groupBy(workspaceMembers.workspaceId);
    const orphaned = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(and(eq(workspaces.isDemo, true), notInArray(workspaces.id, membered)));
    let workspacesRemoved = 0;
    for (const ws of orphaned) {
      for (const rel of await filesForWorkspace(db, ws.id)) {
        await storage.remove(rel);
      }
      await db.delete(workspaces).where(eq(workspaces.id, ws.id));
      workspacesRemoved += 1;
    }

    console.log(`cleanup-demos: removed ${usersRemoved} expired demo user(s), ${workspacesRemoved} orphaned demo workspace(s).`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('cleanup-demos FAILED:', err instanceof Error ? err.message : err);
  process.exit(1);
});
