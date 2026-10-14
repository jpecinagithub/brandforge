/** Shared error-envelope helpers. Every API error looks like {error:{code,message}}. */
import type { FastifyReply } from 'fastify';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True for canonical UUID strings. Use on any UUID-typed input before it reaches the DB. */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

export function sendError(
  reply: FastifyReply,
  status: number,
  code: string,
  message: string,
  details?: unknown,
) {
  const body: { error: { code: string; message: string; details?: unknown } } = {
    error: { code, message },
  };
  if (details !== undefined) body.error.details = details;
  return reply.code(status).send(body);
}

export const Errors = {
  unauthorized: (reply: FastifyReply, message = 'Authentication required') =>
    sendError(reply, 401, 'UNAUTHORIZED', message),
  forbidden: (reply: FastifyReply, message = 'Forbidden') =>
    sendError(reply, 403, 'FORBIDDEN', message),
  notFound: (reply: FastifyReply, message = 'Not found') =>
    sendError(reply, 404, 'NOT_FOUND', message),
  badRequest: (reply: FastifyReply, message: string, details?: unknown) =>
    sendError(reply, 400, 'BAD_REQUEST', message, details),
  validation: (reply: FastifyReply, message: string, details?: unknown) =>
    sendError(reply, 422, 'VALIDATION_ERROR', message, details),
  conflict: (reply: FastifyReply, message: string) =>
    sendError(reply, 409, 'CONFLICT', message),
  tooMany: (reply: FastifyReply, message = 'Too many requests') =>
    sendError(reply, 429, 'RATE_LIMITED', message),
  internal: (reply: FastifyReply, message = 'Internal server error') =>
    sendError(reply, 500, 'INTERNAL_ERROR', message),
};

/** Format a ZodError into a compact details payload. */
export function zodDetails(err: { issues: Array<{ path: (string | number)[]; message: string }> }) {
  return err.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
}
