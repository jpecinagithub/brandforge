/**
 * Apply pending Drizzle SQL migrations without drizzle-kit (dev-only dep).
 * Works in the production image: uses drizzle-orm's postgres-js migrator.
 * Migrations folder resolves relative to this file in both src/ and dist/.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = process.env.MIGRATIONS_DIR
  ?? path.resolve(__dirname, '../../../../packages/database/drizzle');

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const client = postgres(url, { max: 1 });
  try {
    const db = drizzle(client);
    await migrate(db, { migrationsFolder });
    console.log(`migrations applied from ${migrationsFolder}`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('[migrate] fatal:', err);
  process.exit(1);
});
