/**
 * Chat routes (HONEST STUB — Phase 2).
 *
 * GET  /api/v1/projects/:projectId/conversation → {conversation, messages}
 * POST /api/v1/conversations/:id/messages {content}
 *      → saves the user message, then saves an assistant message with a fixed,
 *        honest notice that AI generation is not configured in this build
 *        (Phase 3). No model is called; nothing is hallucinated.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { asc, eq } from 'drizzle-orm';
import { conversations, messages, type Db, type Message } from '@brandforge/database';
import { SendMessageInputSchema } from '@brandforge/shared';
import { getDb } from '../db.js';
import { Errors, zodDetails } from '../errors.js';
import { audit, requestMeta } from '../authz.js';
import { projectGuard } from './projects.js';

type Authed = FastifyRequest & { user: NonNullable<FastifyRequest['user']> };

export const AI_NOT_CONFIGURED_NOTICE = 'AI_NOT_CONFIGURED';
export const AI_STUB_REPLY =
  'AI generation is not configured yet in this build (Phase 3). Your message was saved to the project conversation.';

export function toMessageApi(m: Message) {
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    createdAt: m.createdAt.toISOString(),
  };
}

async function getOrCreateConversation(db: Db, projectId: string): Promise<string> {
  const rows = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.projectId, projectId))
    .orderBy(asc(conversations.createdAt))
    .limit(1);
  if (rows.length > 0) return rows[0].id;
  const [conv] = await db.insert(conversations).values({ projectId, title: '' }).returning();
  return conv.id;
}

export async function conversationRoutes(app: FastifyInstance): Promise<void> {
  const db: Db = getDb();

  app.get('/api/v1/projects/:projectId/conversation', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const p = await projectGuard(db, request, reply, projectId, 'viewer');
    if (!p) return;
    const conversationId = await getOrCreateConversation(db, projectId);
    const msgs = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(asc(messages.createdAt));
    return { conversation: { id: conversationId }, messages: msgs.map(toMessageApi) };
  });

  app.post('/api/v1/conversations/:id/messages', { preHandler: [app.authenticate] }, async (request, reply) => {
    const req = request as Authed;
    const { id } = request.params as { id: string };
    const parsed = SendMessageInputSchema.safeParse(request.body);
    if (!parsed.success) return Errors.validation(reply, 'Invalid input', zodDetails(parsed.error));
    const [conv] = await db.select().from(conversations).where(eq(conversations.id, id)).limit(1);
    if (!conv) return Errors.notFound(reply);
    const p = await projectGuard(db, request, reply, conv.projectId, 'viewer');
    if (!p) return;

    const [userMsg] = await db
      .insert(messages)
      .values({ conversationId: id, role: 'user', content: parsed.data.content })
      .returning();
    const [assistantMsg] = await db
      .insert(messages)
      .values({
        conversationId: id,
        role: 'assistant',
        content: AI_STUB_REPLY,
        meta: { notice: AI_NOT_CONFIGURED_NOTICE, stub: true },
      })
      .returning();
    const { ip, userAgent } = requestMeta(request);
    await audit(db, { userId: req.user.rawId, action: 'chat.stub_message', ip, userAgent, meta: { conversationId: id } });
    return {
      message: toMessageApi(userMsg),
      reply: { ...toMessageApi(assistantMsg), notice: AI_NOT_CONFIGURED_NOTICE },
    };
  });
}
