/** Zod body/query parsing into the shared error envelope. */
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { Errors, zodDetails } from './errors.js';

export function parseBody<T>(schema: z.ZodType<T>, body: unknown, reply: FastifyReply): T | null {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    Errors.validation(reply, 'Invalid input', zodDetails(parsed.error));
    return null;
  }
  return parsed.data;
}
