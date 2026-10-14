import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { getDb } from '../db.js';
import pkg from '../../package.json' with { type: 'json' };

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => ({ status: 'ok', version: (pkg as { version: string }).version }));

  app.get('/ready', async () => {
    try {
      await getDb().execute(sql`select 1`);
      return { status: 'ok', db: 'up' as const };
    } catch {
      return { status: 'degraded', db: 'down' as const };
    }
  });
}
