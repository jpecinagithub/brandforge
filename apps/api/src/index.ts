/** BrandForge API — Fastify bootstrap. */
import 'dotenv/config';
import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { and, isNull, lt } from 'drizzle-orm';
import { auditLogs, sessions } from '@brandforge/database';
import { config } from './config.js';
import { getDb, closeDb } from './db.js';
import { isUuid, sendError } from './errors.js';
import { registerAuthHooks } from './authz.js';
import { healthRoutes } from './routes/health.js';
import { authRoutes } from './routes/auth.js';
import { userRoutes } from './routes/users.js';
import { workspaceRoutes } from './routes/workspaces.js';
import { projectRoutes } from './routes/projects.js';
import { campaignRoutes } from './routes/campaigns.js';
import { brandKitRoutes } from './routes/brandkits.js';
import { conversationRoutes } from './routes/conversations.js';
import { assetRoutes } from './routes/assets.js';
import { adminRoutes } from './routes/admin.js';
import { agentRoutes } from './routes/agent.js';
import { devMailRoutes } from './routes/devmail.js';

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      redact: ['req.headers.cookie', 'req.headers.authorization'],
    },
    requestIdHeader: 'x-request-id',
    requestIdLogLabel: 'requestId',
    genReqId: () => crypto.randomUUID(),
    trustProxy: true,
  });

  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  // Global guard: any route param named `id` or ending in `Id` is a UUID column.
  // Reject malformed values with 400 before they reach Postgres (which would 500).
  app.addHook('preHandler', async (request, reply) => {
    const params = (request.params ?? {}) as Record<string, unknown>;
    for (const [key, value] of Object.entries(params)) {
      if ((key === 'id' || key.endsWith('Id')) && !isUuid(value)) {
        return sendError(reply, 400, 'BAD_REQUEST', `${key} must be a valid UUID`);
      }
    }
  });

  await app.register(helmet);
  await app.register(cors, { origin: config.corsOrigins, credentials: true });
  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
  await app.register(rateLimit, { max: 300, timeWindow: '15 minutes' });

  if (!config.isProduction) {
    await app.register(swagger, {
      openapi: {
        info: { title: 'BrandForge API', version: '0.1.0', description: 'Phase 3: agentic engine' },
      },
    });
    await app.register(swaggerUi, { routePrefix: '/docs' });
  }

  await registerAuthHooks(app, getDb());

  // 404 envelope
  app.setNotFoundHandler((_request, reply) => sendError(reply, 404, 'NOT_FOUND', 'Not found'));

  // Unexpected errors → envelope + audit log (feeds admin errorsLast24h)
  app.setErrorHandler(async (rawError, request, reply) => {
    const error = rawError as { statusCode?: number; message?: string };
    const status = typeof error.statusCode === 'number' && error.statusCode >= 400 ? error.statusCode : 500;
    try {
      await getDb().insert(auditLogs).values({
        action: 'error',
        ip: request.ip ?? null,
        userAgent: (request.headers['user-agent'] as string) ?? null,
        meta: { status, message: (error.message ?? 'unknown').slice(0, 500), url: request.url },
      });
    } catch {
      // never fail the error path on logging
    }
    request.log.error({ err: rawError, requestId: request.id }, 'unhandled error');
    if (status === 429) return sendError(reply, 429, 'RATE_LIMITED', 'Too many requests');
    return sendError(
      reply,
      status,
      status === 404 ? 'NOT_FOUND' : 'INTERNAL_ERROR',
      status === 500 ? 'Internal server error' : (error.message ?? 'Request failed'),
    );
  });

  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(userRoutes);
  await app.register(workspaceRoutes);
  await app.register(projectRoutes);
  await app.register(campaignRoutes);
  await app.register(brandKitRoutes);
  await app.register(conversationRoutes);
  await app.register(assetRoutes);
  await app.register(adminRoutes);
  await app.register(agentRoutes);
  await app.register(devMailRoutes);

  // Revoke sessions that expired while the server was down (best effort)
  app.addHook('onReady', async () => {
    try {
      await getDb()
        .update(sessions)
        .set({ revokedAt: new Date() })
        .where(and(isNull(sessions.revokedAt), lt(sessions.expiresAt, new Date())));
    } catch (err) {
      app.log.warn({ err }, 'expired-session sweep failed');
    }
  });

  return app;
}

async function main() {
  const app = await buildApp();
  const shutdown = async () => {
    await app.close().catch(() => undefined);
    await closeDb();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  await app.listen({ port: config.port, host: '0.0.0.0' });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('Failed to start API:', err);
    process.exit(1);
  });
}
