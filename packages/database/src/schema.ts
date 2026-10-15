/**
 * BrandForge database schema (Drizzle ORM, PostgreSQL).
 *
 * Conventions:
 * - Every table: `id uuid PK default gen_random_uuid()`, `created_at timestamptz default now()`.
 * - Mutable tables additionally carry `updated_at timestamptz` (maintained by the app on writes).
 * - Agent tables: agent_runs (+ agent_steps, agent_tool_calls, agent_events),
 *   model_usage, usage_quotas, credit_ledger, agent_memories — see ADR-0006.
 * - status columns are TEXT validated in app code against @brandforge/shared
 *   RUN_STATES (avoids enum churn in migrations).
 */
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------
export const userStatusEnum = pgEnum('user_status', ['pending', 'active', 'blocked']);
export const workspaceRoleEnum = pgEnum('workspace_role', ['owner', 'editor', 'viewer']);
export const messageRoleEnum = pgEnum('message_role', ['user', 'assistant', 'system']);
export const languageEnum = pgEnum('language', ['en', 'es']);
export const themeEnum = pgEnum('theme', ['light', 'dark', 'system']);

// ---------------------------------------------------------------------------
// Users & auth
// ---------------------------------------------------------------------------
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    passwordHash: text('password_hash'),
    status: userStatusEnum('status').notNull().default('pending'),
    isAdmin: boolean('is_admin').notNull().default(false),
    isDemo: boolean('is_demo').notNull().default(false),
    demoExpiresAt: timestamp('demo_expires_at', { withTimezone: true }),
    language: languageEnum('language').notNull().default('en'),
    theme: themeEnum('theme').notNull().default('system'),
    avatarPath: text('avatar_path'),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
  },
  (t) => [
    // email uniqueness is case-insensitive
    uniqueIndex('users_email_lower_idx').on(sql`lower(${t.email})`),
    index('users_status_idx').on(t.status),
  ],
);

export const emailVerificationTokens = pgTable(
  'email_verification_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('email_verification_tokens_user_idx').on(t.userId)],
);

export const passwordResetTokens = pgTable(
  'password_reset_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('password_reset_tokens_user_idx').on(t.userId)],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    ip: text('ip'),
    userAgent: text('user_agent'),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

// ---------------------------------------------------------------------------
// Workspaces
// ---------------------------------------------------------------------------
export const workspaces = pgTable('workspaces', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  isDemo: boolean('is_demo').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
});

export const workspaceMembers = pgTable(
  'workspace_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: workspaceRoleEnum('role').notNull().default('viewer'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('workspace_members_unique_idx').on(t.workspaceId, t.userId),
    index('workspace_members_user_idx').on(t.userId),
  ],
);

// ---------------------------------------------------------------------------
// Projects, campaigns, brand kits
// ---------------------------------------------------------------------------
export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    isFavorite: boolean('is_favorite').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
  },
  (t) => [index('projects_workspace_idx').on(t.workspaceId)],
);

export const campaigns = pgTable('campaigns', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  objective: text('objective').notNull().default(''),
  status: text('status').notNull().default('draft'),
  isFavorite: boolean('is_favorite').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
});

export const brandKits = pgTable('brand_kits', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id')
    .notNull()
    .unique()
    .references(() => projects.id, { onDelete: 'cascade' }),
  brandName: text('brand_name').notNull(),
  tagline: text('tagline').notNull().default(''),
  description: text('description').notNull().default(''),
  colors: jsonb('colors').notNull().default('[]'),
  fonts: jsonb('fonts').notNull().default('[]'),
  tone: text('tone').notNull().default(''),
  audience: text('audience').notNull().default(''),
  logoAssetId: uuid('logo_asset_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
});

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------
export const assets = pgTable(
  'assets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    filename: text('filename').notNull(),
    originalName: text('original_name').notNull(),
    mime: text('mime').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    kind: text('kind').notNull().default('image'),
    width: integer('width'),
    height: integer('height'),
    isDemo: boolean('is_demo').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
  },
  (t) => [index('assets_project_idx').on(t.projectId)],
);

// ---------------------------------------------------------------------------
// Design docs & landing pages
// ---------------------------------------------------------------------------
export const designDocuments = pgTable('design_documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  canvas: jsonb('canvas').notNull().default('{}'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
});

export const landingPages = pgTable('landing_pages', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  schema: jsonb('schema').notNull().default('{}'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
});

// ---------------------------------------------------------------------------
// Conversations and agent-generated messages
// ---------------------------------------------------------------------------
export const conversations = pgTable('conversations', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  title: text('title').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
});

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    role: messageRoleEnum('role').notNull(),
    content: text('content').notNull(),
    meta: jsonb('meta').notNull().default('{}'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('messages_conversation_idx').on(t.conversationId)],
);

// ---------------------------------------------------------------------------
// Audit & settings
// ---------------------------------------------------------------------------
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    ip: text('ip'),
    userAgent: text('user_agent'),
    meta: jsonb('meta').notNull().default('{}'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('audit_logs_action_created_idx').on(t.action, t.createdAt)],
);

export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
});

// ---------------------------------------------------------------------------
// PHASE 3 — agent engine tables (orchestrator runs, queue, events, ledger,
// memory). See docs/adr/0006-phase3-queue-and-orchestrator.md.
// Conventions: status columns are text validated in app code against
// @brandforge/shared RUN_STATES (keeps migrations simple, no enum churn).
// ---------------------------------------------------------------------------
export const agentRuns = pgTable(
  'agent_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id').references(() => conversations.id, {
      onDelete: 'set null',
    }),
    input: text('input').notNull(),
    status: text('status').notNull().default('pending'),
    plan: jsonb('plan').notNull().default('{}'),
    completedSteps: integer('completed_steps').notNull().default(0),
    totalSteps: integer('total_steps').notNull().default(0),
    costUsd: numeric('cost_usd').notNull().default('0'),
    budgetUsd: numeric('budget_usd'),
    maxSteps: integer('max_steps').notNull().default(25),
    attempts: integer('attempts').notNull().default(0),
    idempotencyKey: text('idempotency_key'),
    error: text('error'),
    approval: jsonb('approval'),
    claimedBy: text('claimed_by'),
    heartbeatAt: timestamp('heartbeat_at', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
  },
  (t) => [
    index('agent_runs_status_created_idx').on(t.status, t.createdAt),
    index('agent_runs_project_idx').on(t.projectId),
    uniqueIndex('agent_runs_idempotency_key_uidx').on(t.idempotencyKey),
  ],
);

export const agentSteps = pgTable(
  'agent_steps',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id')
      .notNull()
      .references(() => agentRuns.id, { onDelete: 'cascade' }),
    stepNo: integer('step_no').notNull(),
    kind: text('kind').notNull(),
    title: text('title').notNull().default(''),
    status: text('status').notNull().default('pending'),
    detail: jsonb('detail').notNull().default('{}'),
    error: text('error'),
    tokensIn: integer('tokens_in').notNull().default(0),
    tokensOut: integer('tokens_out').notNull().default(0),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
  },
  (t) => [index('agent_steps_run_idx').on(t.runId)],
);

export const agentToolCalls = pgTable(
  'agent_tool_calls',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    stepId: uuid('step_id')
      .notNull()
      .references(() => agentSteps.id, { onDelete: 'cascade' }),
    tool: text('tool').notNull(),
    args: jsonb('args').notNull().default('{}'),
    argsHash: text('args_hash'),
    status: text('status').notNull().default('pending'),
    result: jsonb('result'),
    error: text('error'),
    durationMs: integer('duration_ms'),
    costUsd: numeric('cost_usd'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
  },
  (t) => [
    index('agent_tool_calls_step_idx').on(t.stepId),
    uniqueIndex('agent_tool_calls_idem_uidx').on(t.stepId, t.tool, t.argsHash),
  ],
);

/** Append-only event log per run; the SSE endpoint tails this table. */
export const agentEvents = pgTable(
  'agent_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id')
      .notNull()
      .references(() => agentRuns.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    type: text('type').notNull(),
    payload: jsonb('payload').notNull().default('{}'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('agent_events_run_seq_uidx').on(t.runId, t.seq),
    index('agent_events_run_seq_idx').on(t.runId, t.seq),
  ],
);

export const modelUsage = pgTable(
  'model_usage',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id').references(() => agentRuns.id, { onDelete: 'set null' }),
    model: text('model').notNull(),
    tool: text('tool'),
    tokensIn: integer('tokens_in').notNull().default(0),
    tokensOut: integer('tokens_out').notNull().default(0),
    costUsd: numeric('cost_usd'),
    durationMs: integer('duration_ms'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
  },
  (t) => [index('model_usage_run_idx').on(t.runId), index('model_usage_model_created_idx').on(t.model, t.createdAt)],
);

export const usageQuotas = pgTable('usage_quotas', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .unique()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  plan: text('plan').notNull().default('free'),
  limits: jsonb('limits').notNull().default('{}'),
  creditsBalance: numeric('credits_balance').notNull().default('0'),
  aiGenerationsUsed: integer('ai_generations_used').notNull().default(0),
  aiGenerationsLimit: integer('ai_generations_limit').notNull().default(0),
  periodMonth: text('period_month'),
  aiEnabled: boolean('ai_enabled').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
});

/**
 * Commercial credit ledger (spec §17): grant = monthly plan allowance,
 * reserve = pre-generation hold, settle = actual charge, refund = release
 * of a hold when the operation fails. Raw model tokens live in model_usage
 * and are NEVER confused with credits.
 */
export const creditLedger = pgTable(
  'credit_ledger',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    delta: numeric('delta').notNull(),
    kind: text('kind').notNull(),
    refType: text('ref_type').notNull(),
    refId: uuid('ref_id'),
    // Links a settle/refund adjustment to the exact reserve it closes.
    // PostgreSQL permits multiple NULLs, while the unique index guarantees
    // that a reservation can never be released more than once.
    reservationId: uuid('reservation_id'),
    balanceAfter: numeric('balance_after').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('credit_ledger_workspace_created_idx').on(t.workspaceId, t.createdAt),
    uniqueIndex('credit_ledger_reservation_uidx').on(t.reservationId),
  ],
);

/**
 * Agent memory (spec §11): project scope (brand kit, decisions, resources)
 * and user scope (authorised reusable preferences). Session memory lives on
 * the agent_runs row itself (input/plan). Summaries, never full histories,
 * are sent to models. pgvector is a documented future option, not in v1.
 */
export const agentMemories = pgTable(
  'agent_memories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    scope: text('scope').notNull(),
    ownerId: uuid('owner_id').notNull(),
    key: text('key').notNull(),
    value: jsonb('value').notNull().default('{}'),
    summary: text('summary'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('agent_memories_scope_owner_key_uidx').on(t.scope, t.ownerId, t.key),
    index('agent_memories_scope_owner_idx').on(t.scope, t.ownerId),
  ],
);

// ---------------------------------------------------------------------------
// Type helpers
// ---------------------------------------------------------------------------
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Workspace = typeof workspaces.$inferSelect;
export type WorkspaceMember = typeof workspaceMembers.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type Campaign = typeof campaigns.$inferSelect;
export type BrandKit = typeof brandKits.$inferSelect;
export type Asset = typeof assets.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;
export type AgentRun = typeof agentRuns.$inferSelect;
export type AgentEventRow = typeof agentEvents.$inferSelect;
export type AgentStep = typeof agentSteps.$inferSelect;
export type CreditLedgerEntry = typeof creditLedger.$inferSelect;
export type AgentMemory = typeof agentMemories.$inferSelect;
