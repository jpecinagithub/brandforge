/**
 * Promote a user to admin: `npm run promote-admin -- <email>`
 * Reads DATABASE_URL from the environment.
 */
import 'dotenv/config';
import { eq, sql } from 'drizzle-orm';
import { createClient, createDb } from '../db.js';
import { users } from '@brandforge/database';

async function main(): Promise<void> {
  const email = process.argv[2];
  if (!email) {
    console.error('Usage: npm run promote-admin -- <email>');
    process.exit(1);
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set');
  const client = createClient(databaseUrl);
  const db = createDb(client);
  try {
    const rows = await db
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = lower(${email})`)
      .limit(1);
    if (rows.length === 0) {
      console.error(`No user found with email ${email}`);
      process.exit(1);
    }
    await db.update(users).set({ isAdmin: true, updatedAt: new Date() }).where(eq(users.id, rows[0].id));
    console.log(`OK: ${rows[0].email} is now an admin.`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('promote-admin FAILED:', err instanceof Error ? err.message : err);
  process.exit(1);
});
