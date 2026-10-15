/**
 * User account routes: /api/v1/users/me*
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, eq, isNull, ne } from 'drizzle-orm';
import { sessions, users, type Db } from '@brandforge/database';
import {
  ChangePasswordInputSchema,
  DeleteAccountInputSchema,
  UpdateMeInputSchema,
  type UserPublic,
} from '@brandforge/shared';
import { getDb } from '../db.js';
import { Errors, sendError } from '../errors.js';
import { parseBody } from '../validate.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { audit, requestMeta, toUserPublic } from '../authz.js';
import { AVATAR_MAX_BYTES, buildObjectPath, detectImage, getStorage } from '../storage.js';

type Authed = FastifyRequest & { user: NonNullable<FastifyRequest['user']> };

function strip(user: UserPublic & { rawId: string }): UserPublic {
  const { rawId: _rawId, ...rest } = user;
  return rest;
}

export async function userRoutes(app: FastifyInstance): Promise<void> {
  const db: Db = getDb();
  const prefix = '/api/v1/users';

  app.get(`${prefix}/me`, { preHandler: [app.authenticate] }, async (request) => {
    return { user: strip((request as Authed).user) };
  });

  app.patch(`${prefix}/me`, { preHandler: [app.authenticate] }, async (request, reply) => {
    const req = request as Authed;
    const body = parseBody(UpdateMeInputSchema, request.body, reply);
    if (!body) return;
    if (Object.keys(body).length === 0) return sendError(reply, 400, 'BAD_REQUEST', 'Nothing to update');
    const now = new Date();
    const [user] = await db
      .update(users)
      .set({ ...body, updatedAt: now })
      .where(eq(users.id, req.user.rawId))
      .returning();
    const { ip, userAgent } = requestMeta(request);
    await audit(db, { userId: user.id, action: 'user.update', ip, userAgent });
    return { user: toUserPublic(user) };
  });

  app.post(`${prefix}/me/change-password`, { preHandler: [app.authenticate] }, async (request, reply) => {
    const req = request as Authed;
    const body = parseBody(ChangePasswordInputSchema, request.body, reply);
    if (!body) return;
    const [me] = await db.select().from(users).where(eq(users.id, req.user.rawId)).limit(1);
    if (!me || !me.passwordHash || !(await verifyPassword(me.passwordHash, body.currentPassword))) {
      return sendError(reply, 401, 'INVALID_CREDENTIALS', 'Current password is incorrect');
    }
    const now = new Date();
    await db
      .update(users)
      .set({ passwordHash: await hashPassword(body.password), updatedAt: now })
      .where(eq(users.id, me.id));
    // Revoke every session except the current one
    await db
      .update(sessions)
      .set({ revokedAt: now })
      .where(and(eq(sessions.userId, me.id), isNull(sessions.revokedAt), ne(sessions.id, req.sessionDbId ?? '')));
    const { ip, userAgent } = requestMeta(request);
    await audit(db, { userId: me.id, action: 'user.change_password', ip, userAgent });
    return { ok: true };
  });

  app.get(`${prefix}/me/avatar`, { preHandler: [app.authenticate] }, async (request, reply) => {
    const req = request as Authed;
    const [me] = await db.select().from(users).where(eq(users.id, req.user.rawId)).limit(1);
    if (!me?.avatarPath) return Errors.notFound(reply);
    const storage = getStorage();
    let buf: Buffer;
    try {
      buf = await storage.get(me.avatarPath);
    } catch {
      return Errors.notFound(reply);
    }
    const detected = detectImage(buf);
    return reply
      // The SPA and API use different origins in production. Helmet's default
      // same-origin CORP header would otherwise make the browser discard this
      // authenticated image response.
      .header('cross-origin-resource-policy', 'cross-origin')
      .header('content-type', detected?.mime ?? 'application/octet-stream')
      .header('cache-control', 'private, no-store')
      .send(buf);
  });

  app.post(`${prefix}/me/avatar`, { preHandler: [app.authenticate] }, async (request, reply) => {
    const req = request as Authed;
    const file = await request.file();
    if (!file) return sendError(reply, 400, 'BAD_REQUEST', 'No file uploaded');
    const buf = await file.toBuffer();
    if (buf.length > AVATAR_MAX_BYTES) {
      return sendError(reply, 413, 'FILE_TOO_LARGE', 'Avatar must be 2MB or smaller');
    }
    const detected = detectImage(buf);
    if (!detected) {
      return sendError(reply, 415, 'UNSUPPORTED_FILE', 'Avatar must be a PNG, JPEG, GIF or WebP image');
    }
    const [me] = await db.select().from(users).where(eq(users.id, req.user.rawId)).limit(1);
    if (!me) return Errors.notFound(reply);
    const storage = getStorage();
    const rel = await storage.put(buildObjectPath('avatars', me.id, `avatar${detected.ext}`), buf);
    if (me.avatarPath) await storage.remove(me.avatarPath);
    const now = new Date();
    const [user] = await db
      .update(users)
      .set({ avatarPath: rel, updatedAt: now })
      .where(eq(users.id, me.id))
      .returning();
    const { ip, userAgent } = requestMeta(request);
    await audit(db, { userId: me.id, action: 'user.avatar', ip, userAgent });
    return { user: toUserPublic(user) };
  });

  app.get(`${prefix}/me/sessions`, { preHandler: [app.authenticate] }, async (request) => {
    const req = request as Authed;
    const rows = await db
      .select()
      .from(sessions)
      .where(and(eq(sessions.userId, req.user.rawId), isNull(sessions.revokedAt)));
    return {
      sessions: rows.map((s) => ({
        id: s.id,
        createdAt: s.createdAt.toISOString(),
        expiresAt: s.expiresAt.toISOString(),
        lastSeenAt: s.lastSeenAt.toISOString(),
        ip: s.ip,
        userAgent: s.userAgent,
        current: s.id === req.sessionDbId,
      })),
    };
  });

  app.delete(`${prefix}/me/sessions/:id`, { preHandler: [app.authenticate] }, async (request, reply) => {
    const req = request as Authed;
    const { id } = request.params as { id: string };
    if (id === req.sessionDbId) {
      return sendError(reply, 400, 'BAD_REQUEST', 'Cannot revoke the current session here — use logout');
    }
    const [row] = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(and(eq(sessions.id, id), eq(sessions.userId, req.user.rawId), isNull(sessions.revokedAt)))
      .limit(1);
    if (!row) return Errors.notFound(reply);
    await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, id));
    const { ip, userAgent } = requestMeta(request);
    await audit(db, { userId: req.user.rawId, action: 'session.revoke', ip, userAgent });
    return { ok: true };
  });

  app.delete(`${prefix}/me`, { preHandler: [app.authenticate] }, async (request, reply) => {
    const req = request as Authed;
    const [me] = await db.select().from(users).where(eq(users.id, req.user.rawId)).limit(1);
    if (!me) return Errors.notFound(reply);
    if (!me.isDemo) {
      const body = parseBody(DeleteAccountInputSchema, request.body ?? {}, reply);
      if (!body) return;
      if (!me.passwordHash || !(await verifyPassword(me.passwordHash, body.password))) {
        return sendError(reply, 401, 'INVALID_CREDENTIALS', 'Password is incorrect');
      }
    }
    const { ip, userAgent } = requestMeta(request);
    await audit(db, { userId: me.id, action: 'user.delete', ip, userAgent });
    const storage = getStorage();
    if (me.avatarPath) await storage.remove(me.avatarPath);
    reply.clearCookie('bf_session', { path: '/' });
    await db.delete(users).where(eq(users.id, me.id)); // cascades sessions, tokens, memberships
    return { ok: true };
  });
}
