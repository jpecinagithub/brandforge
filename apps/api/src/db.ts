/** Singleton DB client for the API process. */
import { createClient, createDb, type Db } from '@brandforge/database';
import { config } from './config.js';

export { createClient, createDb };
export type { Db };

let db: Db | null = null;
let raw: ReturnType<typeof createClient> | null = null;

export function getDb(): Db {
  if (!db) {
    raw = createClient(config.databaseUrl);
    db = createDb(raw);
  }
  return db;
}

export async function closeDb(): Promise<void> {
  if (raw) {
    await raw.end();
    raw = null;
    db = null;
  }
}
