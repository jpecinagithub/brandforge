/**
 * Authentication + workspace authorization helpers. Pure/testable where noted.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { and, eq, isNull } from 'drizzle-orm';
import {
  projects,
  sessions,
  users,
  workspaceMembers,
  type Db,
} from '@brandforge/database';
import type { UserPublic, WorkspaceRole } from '@brandforge/shared';
import { sha256Hex } from './auth/tokens.js';
import { Errors, sendError } from './errors.js';

export const SESSION_COOKIE = 'bf_session';

const ROLE_RANK: Record<WorkspaceRole, number> = { viewer: 1, editor: 2, owner: 3 };

export function roleAtLeast(role: WorkspaceRole | null, min: WorkspaceRole): boolean {
  if (!role) return false;
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

/** Load a user's workspace role, or null when not a member. */
export async function getMembership(
  db: Db,
  userId: string,
  workspaceId: string,
): Promise<WorkspaceRole | null> {
  const rows = await db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.userId, userId), eq(workspaceMembers.workspaceId, workspaceId)))
    .limit(1);
  return rows.length > 0 ? (rows[0].role as WorkspaceRole) : null;
}

/** Resolve the workspace that owns a project (for project-scoped routes). */
export async function projectWorkspaceId(db: Db, projectId: string): Promise<string | null> {
  const rows = await db
    .select({ workspaceId: projects.workspaceId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  return rows.length > 0 ? rows[0].workspaceId : null;
}

export function toUserPublic(u: {
  id: string;
  email: string;
  name: string;
  status: UserPublic['status'];
  isAdmin: boolean;
  isDemo: boolean;
  language: UserPublic['language'];
  theme: UserPublic['theme'];
  avatarPath: string | null;
  emailVerifiedAt: Date | null;
  createdAt: Date;
}): UserPublic {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    status: u.status,
    isAdmin: u.isAdmin,
    isDemo: u.isDemo,
    language: u.language,
    theme: u.theme,
    avatarPath: u.avatarPath,
    avatarUrl: u.avatarPath ? '/api/v1/users/me/avatar' : null,
    emailVerifiedAt: u.emailVerifiedAt ? u.emailVerifiedAt.toISOString() : null,
    createdAt: u.createdAt.toISOString(),
  };
}

export async function audit(
  db: Db,
  entry: { userId?: string | null; action: string; ip?: string | null; userAgent?: string | null; meta?: unknown },
): Promise<void> {
  const { auditLogs } = await import('@brandforge/database');
  await db.insert(auditLogs).values({
    userId: entry.userId ?? null,
    action: entry.action,
    ip: entry.ip ?? null,
    userAgent: entry.userAgent ?? null,
    meta: (entry.meta ?? {}) as Record<string, unknown>,
  });
}

declare module 'fastify' {
  interface FastifyRequest {
    user: UserPublic & { rawId: string } | null;
    sessionDbId: string | null;
  }
}

export function requestMeta(request: FastifyRequest) {
  return { ip: request.ip ?? null, userAgent: (request.headers['user-agent'] as string) ?? null };
}

/** preHandler: populate request.user from the bf_session cookie. 401 when absent/invalid. */
export function authenticate(db: Db) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const token = request.cookies?.[SESSION_COOKIE];
    if (!token) return Errors.unauthorized(reply);
    const rows = await db
      .select({ session: sessions, user: users })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(and(eq(sessions.tokenHash, sha256Hex(token)), isNull(sessions.revokedAt)))
      .limit(1);
    const row = rows[0];
    if (!row || row.session.expiresAt.getTime() < Date.now()) {
      return Errors.unauthorized(reply);
    }
    await db
      .update(sessions)
      .set({ lastSeenAt: new Date() })
      .where(eq(sessions.id, row.session.id));
    request.user = { ...toUserPublic(row.user), rawId: row.user.id };
    request.sessionDbId = row.session.id;
  };
}

/** preHandler: require an authenticated admin user. */
export function requireAdmin() {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user) return Errors.unauthorized(reply);
    if (!request.user.isAdmin) return sendError(reply, 403, 'ADMIN_REQUIRED', 'Admin access required');
  };
}

/**
 * Build a preHandler enforcing a minimum workspace role.
 * `workspaceIdFrom` extracts the workspace id from request params; when the
 * resource is not found or the user is not a member, reply 404 (never 403) to
 * avoid leaking existence.
 */
export function requireWorkspaceRole(
  db: Db,
  minRole: WorkspaceRole,
  workspaceIdFrom: (request: FastifyRequest) => string | undefined,
) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user) return Errors.unauthorized(reply);
    const workspaceId = workspaceIdFrom(request);
    if (!workspaceId) return Errors.notFound(reply);
    const role = await getMembership(db, request.user.rawId, workspaceId);
    if (!roleAtLeast(role, minRole)) return Errors.notFound(reply);
  };
}

export async function registerAuthHooks(app: FastifyInstance, db: Db): Promise<void> {
  app.decorateRequest('user', null);
  app.decorateRequest('sessionDbId', null);
  // expose the shared authenticate factory for routes
  app.decorate('authenticate', authenticate(db));
  app.decorate('requireAdmin', requireAdmin());
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: ReturnType<typeof authenticate>;
    requireAdmin: ReturnType<typeof requireAdmin>;
  }
}
