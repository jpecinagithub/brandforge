/**
 * Authentication routes: /api/v1/auth/*
 * All payloads are JSON; errors use the shared {error:{code,message}} envelope.
 */
import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { and, eq, isNull, sql } from 'drizzle-orm';
import {
  emailVerificationTokens,
  passwordResetTokens,
  sessions,
  users,
  workspaceMembers,
  workspaces,
  type Db,
} from '@brandforge/database';
import {
  ForgotPasswordInputSchema,
  LoginInputSchema,
  RegisterInputSchema,
  ResendVerificationInputSchema,
  ResetPasswordInputSchema,
  VerifyEmailInputSchema,
  type UserPublic,
} from '@brandforge/shared';
import { config } from '../config.js';
import { getDb } from '../db.js';
import { sendError } from '../errors.js';
import { parseBody } from '../validate.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { daysFromNow, hoursFromNow, randomToken, sha256Hex } from '../auth/tokens.js';
import {
  SESSION_COOKIE,
  audit,
  requestMeta,
  toUserPublic,
} from '../authz.js';
import { sendEmail, verificationEmail, resetPasswordEmail, welcomeEmail } from '../email.js';
import { getStorage, type StorageAdapter } from '../storage.js';
import { seedDemoContent, type StorageWriter } from '@brandforge/database';

type AuthenticatedRequest = FastifyRequest & { user: NonNullable<FastifyRequest['user']> };

async function findUserByEmail(db: Db, email: string) {
  const rows = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = lower(${email})`)
    .limit(1);
  return rows[0] ?? null;
}

async function createSession(db: Db, userId: string, request: FastifyRequest) {
  const token = randomToken();
  const { ip, userAgent } = requestMeta(request);
  const [row] = await db
    .insert(sessions)
    .values({
      userId,
      tokenHash: sha256Hex(token),
      expiresAt: daysFromNow(config.sessionTtlDays),
      ip,
      userAgent,
    })
    .returning({ id: sessions.id });
  return { token, sessionId: row.id };
}

function setSessionCookie(reply: FastifyReply, token: string) {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    path: '/',
    sameSite: config.cookieSameSite,
    secure: config.cookieSecure,
    maxAge: config.sessionTtlDays * 86_400,
  });
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  const db = getDb();
  const prefix = '/api/v1/auth';

  // ------------------------------------------------ register
  app.post(
    `${prefix}/register`,
    { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } },
    async (request, reply) => {
      const body = parseBody(RegisterInputSchema, request.body, reply);
      if (!body) return;
      if (await findUserByEmail(db, body.email)) {
        return sendError(reply, 409, 'EMAIL_TAKEN', 'An account with this email already exists');
      }
      const [user] = await db
        .insert(users)
        .values({
          name: body.name,
          email: body.email.trim(),
          passwordHash: await hashPassword(body.password),
          status: 'pending',
        })
        .returning();
      await issueVerificationEmail(db, user.id, user.email, user.name);
      // Every account gets a personal workspace so the dashboard works immediately.
      const [ws] = await db.insert(workspaces).values({ name: 'Personal workspace' }).returning();
      await db.insert(workspaceMembers).values({ workspaceId: ws.id, userId: user.id, role: 'owner' });
      const { ip, userAgent } = requestMeta(request);
      await audit(db, { userId: user.id, action: 'auth.register', ip, userAgent });
      return reply.code(201).send({ user: toUserPublic(user) });
    },
  );

  // ------------------------------------------------ verify email (POST body or GET ?token=)
  const verifyHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    const raw = (request.method === 'GET' ? request.query : request.body) as unknown;
    const body = parseBody(VerifyEmailInputSchema, raw, reply);
    if (!body) return;
    const rows = await db
      .select({ token: emailVerificationTokens, user: users })
      .from(emailVerificationTokens)
      .innerJoin(users, eq(emailVerificationTokens.userId, users.id))
      .where(and(eq(emailVerificationTokens.tokenHash, sha256Hex(body.token)), isNull(emailVerificationTokens.usedAt)))
      .limit(1);
    const row = rows[0];
    if (!row || row.token.expiresAt.getTime() < Date.now()) {
      return sendError(reply, 400, 'INVALID_TOKEN', 'Verification link is invalid or expired');
    }
    const now = new Date();
    await db.update(emailVerificationTokens).set({ usedAt: now }).where(eq(emailVerificationTokens.id, row.token.id));
    const [user] = await db
      .update(users)
      .set({ status: 'active', emailVerifiedAt: now, updatedAt: now })
      .where(eq(users.id, row.user.id))
      .returning();
    const { ip, userAgent } = requestMeta(request);
    await audit(db, { userId: user.id, action: 'auth.verify_email', ip, userAgent });
    await sendEmail(welcomeEmail(user.email, user.name)).catch(() => undefined);
    return reply.send({ user: toUserPublic(user) });
  };
  app.post(`${prefix}/verify-email`, verifyHandler);
  app.get(`${prefix}/verify-email`, verifyHandler);

  // ------------------------------------------------ resend verification (neutral)
  app.post(
    `${prefix}/resend-verification`,
    { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } },
    async (request, reply) => {
      const body = parseBody(ResendVerificationInputSchema, request.body, reply);
      if (!body) return;
      const user = await findUserByEmail(db, body.email);
      if (user && user.status === 'pending') {
        await issueVerificationEmail(db, user.id, user.email, user.name);
      }
      const { ip, userAgent } = requestMeta(request);
      await audit(db, { action: 'auth.resend_verification', ip, userAgent });
      return reply.send({ ok: true });
    },
  );

  // ------------------------------------------------ login
  app.post(
    `${prefix}/login`,
    { config: { rateLimit: { max: 20, timeWindow: '15 minutes' } } },
    async (request, reply) => {
      const body = parseBody(LoginInputSchema, request.body, reply);
      if (!body) return;
      const user = await findUserByEmail(db, body.email);
      const { ip, userAgent } = requestMeta(request);
      if (!user || !user.passwordHash || !(await verifyPassword(user.passwordHash, body.password))) {
        await audit(db, { action: 'auth.login_failed', ip, userAgent });
        return sendError(reply, 401, 'INVALID_CREDENTIALS', 'Invalid email or password');
      }
      if (user.status === 'pending') {
        return sendError(reply, 403, 'EMAIL_NOT_VERIFIED', 'Please verify your email address first');
      }
      if (user.status === 'blocked') {
        return sendError(reply, 403, 'ACCOUNT_BLOCKED', 'This account has been blocked');
      }
      const { token } = await createSession(db, user.id, request);
      setSessionCookie(reply, token);
      await audit(db, { userId: user.id, action: 'auth.login', ip, userAgent });
      return reply.send({ user: toUserPublic(user) });
    },
  );

  // ------------------------------------------------ demo (ephemeral demo account + workspace)
  app.post(
    `${prefix}/demo`,
    { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } },
    async (request, reply) => {
      const email = `demo-${randomUUID()}@demo.brandforge.local`;
      const now = new Date();
      const [user] = await db
        .insert(users)
        .values({
          email,
          name: 'Demo user',
          passwordHash: null,
          status: 'active',
          isDemo: true,
          demoExpiresAt: daysFromNow(1),
          emailVerifiedAt: now,
        })
        .returning();
      const [ws] = await db.insert(workspaces).values({ name: 'Demo workspace', isDemo: true }).returning();
      await db.insert(workspaceMembers).values({ workspaceId: ws.id, userId: user.id, role: 'owner' });
      const storage: StorageAdapter = getStorage();
      const writer: StorageWriter = {
        writeFile: async (rel, data) => {
          await storage.put(rel, data);
        },
      };
      await seedDemoContent(db, writer, ws.id, user.id);
      const { token } = await createSession(db, user.id, request);
      setSessionCookie(reply, token);
      const { ip, userAgent } = requestMeta(request);
      await audit(db, { userId: user.id, action: 'auth.demo', ip, userAgent });
      return reply.send({
        user: toUserPublic(user),
        workspace: { id: ws.id, name: ws.name, isDemo: true, role: 'owner' as const },
      });
    },
  );

  // ------------------------------------------------ logout / logout-all
  app.post(`${prefix}/logout`, { preHandler: [app.authenticate] }, async (request, reply) => {
    const req = request as AuthenticatedRequest;
    if (req.sessionDbId) {
      await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, req.sessionDbId));
    }
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    const { ip, userAgent } = requestMeta(request);
    await audit(db, { userId: req.user.rawId, action: 'auth.logout', ip, userAgent });
    return reply.send({ ok: true });
  });

  app.post(`${prefix}/logout-all`, { preHandler: [app.authenticate] }, async (request, reply) => {
    const req = request as AuthenticatedRequest;
    await db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.userId, req.user.rawId), isNull(sessions.revokedAt)));
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    const { ip, userAgent } = requestMeta(request);
    await audit(db, { userId: req.user.rawId, action: 'auth.logout_all', ip, userAgent });
    return reply.send({ ok: true });
  });

  // ------------------------------------------------ forgot password (ALWAYS neutral 200)
  app.post(
    `${prefix}/forgot-password`,
    { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } },
    async (request, reply) => {
      const body = parseBody(ForgotPasswordInputSchema, request.body, reply);
      if (!body) return;
      const user = await findUserByEmail(db, body.email);
      if (user && user.status === 'active' && user.passwordHash) {
        const token = randomToken();
        await db.insert(passwordResetTokens).values({
          userId: user.id,
          tokenHash: sha256Hex(token),
          expiresAt: hoursFromNow(1),
        });
        const link = `${config.frontendUrl}/reset-password?token=${token}`;
        await sendEmail(resetPasswordEmail(user.email, user.name, link)).catch(() => undefined);
      }
      const { ip, userAgent } = requestMeta(request);
      // Neutral audit entry: no user id, nothing that reveals account existence.
      await audit(db, { action: 'auth.forgot_password', ip, userAgent });
      return reply.send({ ok: true });
    },
  );

  // ------------------------------------------------ reset password
  app.post(`${prefix}/reset-password`, async (request, reply) => {
    const body = parseBody(ResetPasswordInputSchema, request.body, reply);
    if (!body) return;
    const rows = await db
      .select({ token: passwordResetTokens, user: users })
      .from(passwordResetTokens)
      .innerJoin(users, eq(passwordResetTokens.userId, users.id))
      .where(and(eq(passwordResetTokens.tokenHash, sha256Hex(body.token)), isNull(passwordResetTokens.usedAt)))
      .limit(1);
    const row = rows[0];
    if (!row || row.token.expiresAt.getTime() < Date.now()) {
      return sendError(reply, 400, 'INVALID_TOKEN', 'Reset link is invalid or expired');
    }
    const now = new Date();
    await db.update(passwordResetTokens).set({ usedAt: now }).where(eq(passwordResetTokens.id, row.token.id));
    await db
      .update(users)
      .set({ passwordHash: await hashPassword(body.password), updatedAt: now })
      .where(eq(users.id, row.user.id));
    await db
      .update(sessions)
      .set({ revokedAt: now })
      .where(and(eq(sessions.userId, row.user.id), isNull(sessions.revokedAt)));
    const { ip, userAgent } = requestMeta(request);
    await audit(db, { userId: row.user.id, action: 'auth.reset_password', ip, userAgent });
    return reply.send({ ok: true });
  });

  // ------------------------------------------------ me
  app.get(`${prefix}/me`, { preHandler: [app.authenticate] }, async (request) => {
    const req = request as AuthenticatedRequest;
    return { user: stripRaw(req.user) };
  });
}

async function issueVerificationEmail(db: Db, userId: string, email: string, name: string): Promise<void> {
  const token = randomToken();
  await db.insert(emailVerificationTokens).values({
    userId,
    tokenHash: sha256Hex(token),
    expiresAt: hoursFromNow(24),
  });
  const link = `${config.frontendUrl}/verify-email?token=${token}`;
  await sendEmail(verificationEmail(email, name, link)).catch(() => undefined);
}

function stripRaw(user: UserPublic & { rawId: string }): UserPublic {
  const { rawId: _rawId, ...rest } = user;
  return rest;
}
