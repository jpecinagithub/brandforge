/**
 * Dev seed: `npm run db:seed --workspace=@brandforge/database`
 *
 * Reads DATABASE_URL and STORAGE_PATH from the environment.
 *
 * !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
 * WARNING: this creates a PERSISTENT, LOCAL-ONLY development account:
 *     demo@brandforge.local / Demo2026!
 * It is NEVER created in production (run this script only against a local
 * dev database), and it must never be exposed to the public internet.
 * It exists solely so developers can smoke-test the API + frontend.
 * !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
 */
import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { createClient, createDb } from './db.js';
import { seedDemoContent, type StorageWriter } from './seed-demo.js';
import { users, workspaceMembers, workspaces } from './schema.js';

const DEMO_EMAIL = 'demo@brandforge.local';
const DEMO_PASSWORD = 'Demo2026!';
const STORAGE_PATH = process.env.STORAGE_PATH ?? './storage';

class LocalStorageWriter implements StorageWriter {
  async writeFile(relativePath: string, data: Buffer): Promise<void> {
    const full = path.join(STORAGE_PATH, relativePath);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, data);
  }
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set');
  }
  const client = createClient(databaseUrl);
  const db = createDb(client);
  try {
    // Idempotent user creation (case-insensitive email)
    const existing = await db
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = lower(${DEMO_EMAIL})`)
      .limit(1);

    let userId: string;
    if (existing.length > 0) {
      userId = existing[0].id;
      console.log(`[seed] Reusing existing demo user ${DEMO_EMAIL}`);
    } else {
      // NOTE: mirrors apps/api/src/auth/password.ts (the canonical impl).
      // Duplicated here so `db:seed` stays self-contained and does not depend
      // on the api build.
      const { default: argon2 } = await import('argon2');
      const [u] = await db
        .insert(users)
        .values({
          email: DEMO_EMAIL,
          name: 'Demo User',
          passwordHash: await argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id }),
          status: 'active',
          isDemo: true,
          demoExpiresAt: null, // persistent LOCAL dev account
          language: 'en',
          theme: 'system',
          emailVerifiedAt: new Date(),
        })
        .returning();
      userId = u.id;
      console.log(`[seed] Created demo user ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
    }

    // Idempotent personal workspace
    const existingWs = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .innerJoin(workspaceMembers, eq(workspaceMembers.workspaceId, workspaces.id))
      .where(eq(workspaceMembers.userId, userId))
      .limit(1);
    let workspaceId: string;
    if (existingWs.length > 0) {
      workspaceId = existingWs[0].id;
    } else {
      const [ws] = await db
        .insert(workspaces)
        .values({ name: 'Demo workspace' })
        .returning();
      await db.insert(workspaceMembers).values({ workspaceId: ws.id, userId, role: 'owner' });
      workspaceId = ws.id;
      console.log(`[seed] Created personal workspace ${ws.id}`);
    }

    const result = await seedDemoContent(db, new LocalStorageWriter(), workspaceId, userId);
    console.log('[seed] Demo content seeded:', JSON.stringify(result, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('[seed] FAILED:', err instanceof Error ? err.message : err);
  process.exit(1);
});
