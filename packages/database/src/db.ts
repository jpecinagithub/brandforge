/** Database connection (drizzle-orm + `postgres` driver). */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

export function createClient(connectionString: string) {
  return postgres(connectionString, { max: 10 });
}

export type DbClient = ReturnType<typeof postgres>;

export function createDb(client: DbClient) {
  return drizzle(client, { schema });
}

export type Db = ReturnType<typeof createDb>;
