/**
 * TEST-ONLY fakes for @brandforge/agent-core unit tests. NOT FOR PRODUCTION.
 *
 * - createFakeDb: minimal in-memory implementation of the drizzle Db surface
 *   used by agent-core (select/insert/update with eq/and conditions). It
 *   evaluates drizzle SQL fragments for the small condition vocabulary the
 *   orchestrator and tools use (eq + and-of-eq). Anything it cannot interpret
 *   is treated permissively — real-DB paths are covered by the backend
 *   integration tests, not here.
 * - FakeOpenRouterClient / FakeModelRouter: scripted OpenRouter shapes.
 * - createFakeBudget / createFakeStorage / createFakeConversation /
 *   createFakeMemory / createFakeEmitter: in-memory port fakes.
 */
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { SQL } from 'drizzle-orm';
import {
  agentMemories,
  agentRuns,
  agentSteps,
  agentToolCalls,
  assets,
  brandKits,
  campaigns,
  designDocuments,
  landingPages,
  projects,
  type Db,
} from '@brandforge/database';
import type { AgentEventType } from '@brandforge/shared';
import type {
  BudgetPort,
  ChatOptions,
  ChatResult,
  ConversationPort,
  ImageOptions,
  ImageResult,
  MemoryStore,
  ModelRouter,
  OpenRouterClient,
  StoragePort,
  TaskKind,
} from '../types.js';

type Row = Record<string, unknown>;

const TABLE_NAMES = new Map<object, string>([
  [agentRuns, 'agent_runs'],
  [agentSteps, 'agent_steps'],
  [agentToolCalls, 'agent_tool_calls'],
  [projects, 'projects'],
  [campaigns, 'campaigns'],
  [brandKits, 'brand_kits'],
  [assets, 'assets'],
  [designDocuments, 'design_documents'],
  [landingPages, 'landing_pages'],
  [agentMemories, 'agent_memories'],
]);

function tableName(table: object): string {
  const name = TABLE_NAMES.get(table);
  if (!name) throw new Error('FakeDb: unknown table object');
  return name;
}

// --- condition evaluation (eq + and-of-eq only) ---------------------------
// Conditions reference DB column names (e.g. idempotency_key) while rows
// are keyed by JS property names (e.g. idempotencyKey); translate via the
// table's column map.
const columnMaps = new Map<object, Map<string, string>>();

function columnMap(table: object): Map<string, string> {
  let map = columnMaps.get(table);
  if (!map) {
    map = new Map<string, string>();
    for (const [jsKey, col] of Object.entries(table)) {
      if (
        col !== null &&
        typeof col === 'object' &&
        typeof (col as { name?: unknown }).name === 'string'
      ) {
        map.set((col as { name: string }).name, jsKey);
      }
    }
    columnMaps.set(table, map);
  }
  return map;
}

function evalCondition(cond: unknown, row: Row, table: object): boolean {
  if (!cond) return true;
  if (cond instanceof SQL) return evalSql(cond, row, table);
  return true;
}

function evalSql(sql: SQL, row: Row, table: object): boolean {
  const chunks = (sql as unknown as { queryChunks: unknown[] }).queryChunks;
  let result = true;
  let current: unknown[] = [];
  const flush = () => {
    if (current.length > 0) {
      result = result && evalComparison(current, row, table);
      current = [];
    }
  };
  for (const ch of chunks) {
    if (ch instanceof SQL) {
      flush();
      result = result && evalSql(ch, row, table);
      continue;
    }
    const rec = ch as { constructor: { name: string }; value?: unknown };
    if (rec.constructor.name === 'StringChunk' && rec.value === ' AND ') {
      flush();
      continue;
    }
    current.push(ch);
  }
  flush();
  return result;
}

function evalComparison(chunks: unknown[], row: Row, table: object): boolean {
  let col: string | null = null;
  let expected: unknown;
  let hasExpected = false;
  for (const ch of chunks) {
    const rec = ch as { constructor: { name: string }; name?: unknown; value?: unknown };
    if (rec.constructor.name === 'Param') {
      expected = rec.value;
      hasExpected = true;
    } else if (rec.constructor.name !== 'StringChunk' && typeof rec.name === 'string') {
      col = rec.name;
    }
  }
  if (col === null || !hasExpected) return true; // uninterpretable → permissive
  const jsKey = columnMap(table).get(col) ?? col;
  const actual = row[jsKey];
  if (expected instanceof Date && actual instanceof Date) {
    return expected.getTime() === actual.getTime();
  }
  return actual === expected;
}

function evalUpdateValue(value: unknown, row: Row, table: object): unknown {
  if (!(value instanceof SQL)) return value;
  let columnName: string | undefined;
  let operand: unknown;
  const visit = (chunks: unknown[]) => {
    for (const chunk of chunks) {
      if (chunk instanceof SQL) {
        visit((chunk as unknown as { queryChunks: unknown[] }).queryChunks);
        continue;
      }
      const rec = chunk as { constructor: { name: string }; name?: unknown; value?: unknown };
      if (rec.constructor.name === 'Param') operand = rec.value;
      else if (rec.constructor.name === 'StringChunk' && Array.isArray(rec.value)) {
        const match = rec.value.join('').match(/\+\s*(-?\d+(?:\.\d+)?)/);
        if (match) operand = Number(match[1]);
      } else if (typeof rec.name === 'string') columnName = rec.name;
    }
  };
  visit((value as unknown as { queryChunks: unknown[] }).queryChunks);
  if (!columnName || operand === undefined) return value;
  const key = columnMap(table).get(columnName) ?? columnName;
  const current = row[key];
  const sum = Number(current ?? 0) + Number(operand);
  return typeof current === 'string' ? String(sum) : sum;
}

// Schema defaults mirrored from packages/database/src/schema.ts (applied on
// insert when the caller does not provide a value, like the real DB would).
const TABLE_DEFAULTS: Record<string, Row> = {
  agent_runs: {
    status: 'pending',
    plan: {},
    completedSteps: 0,
    totalSteps: 0,
    costUsd: '0',
    attempts: 0,
  },
  agent_steps: { status: 'pending', detail: {}, tokensIn: 0, tokensOut: 0 },
  agent_tool_calls: { status: 'pending', args: {} },
};

function applyDefaults(table: object, row: Row): void {
  const defaults = TABLE_DEFAULTS[tableName(table)];
  if (defaults) {
    for (const [k, v] of Object.entries(defaults)) {
      if (row[k] == null) row[k] = v;
    }
  }
  if (row.id == null) row.id = randomUUID();
  if (row.createdAt == null) row.createdAt = new Date();
}

// --- fake Db ---------------------------------------------------------------
export interface FakeDb {
  __table(name: string): Row[];
}

export function createFakeDb(seed: Record<string, Row[]> = {}): Db & FakeDb {
  const tables = new Map<string, Row[]>();
  for (const [name, rows] of Object.entries(seed)) {
    tables.set(name, rows.map((r) => ({ ...r })));
  }
  const rowsFor = (table: object): Row[] => {
    const name = tableName(table);
    if (!tables.has(name)) tables.set(name, []);
    return tables.get(name) as Row[];
  };
  const project = (row: Row, table: object, fields?: Record<string, { name: string }>): Row => {
    if (!fields) return { ...row };
    const map = columnMap(table);
    const out: Row = {};
    for (const [alias, col] of Object.entries(fields)) {
      out[alias] = row[map.get(col.name) ?? col.name];
    }
    return out;
  };

  const selectBuilder = (fields?: Record<string, { name: string }>) => ({
    from: (table: object) => {
      const state: { cond?: unknown; limit?: number } = {};
      const chain: Record<string, unknown> = {
        where: (cond: unknown) => {
          state.cond = cond;
          return chain;
        },
        limit: (n: number) => {
          state.limit = n;
          return chain;
        },
        orderBy: () => chain,
        then: (
          resolve: (v: Row[]) => void,
          reject: (e: unknown) => void,
        ) => {
          try {
            let result = rowsFor(table)
              .filter((r) => evalCondition(state.cond, r, table))
              .map((r) => project(r, table, fields));
            if (state.limit !== undefined) result = result.slice(0, state.limit);
            resolve(result);
          } catch (e) {
            reject(e);
          }
        },
      };
      return chain;
    },
  });

  const insertBuilder = (table: object) => ({
    values: (v: Row | Row[]) => {
      const values = Array.isArray(v) ? v : [v];
      const state: { conflict?: { target: { name: string }[]; set: Row } } = {};
      // Shared persist logic: honors onConflictDoUpdate whether or not
      // .returning() was called.
      const persist = (): Row[] => {
        const rows = rowsFor(table);
        const out: Row[] = [];
        for (const value of values) {
          const row: Row = { ...value };
          applyDefaults(table, row);
          if (state.conflict) {
            const cmap = columnMap(table);
            const cols = state.conflict.target.map(
              (c) => cmap.get(c.name) ?? c.name,
            );
            const existing = rows.find((r) =>
              cols.every((cn) => r[cn] === row[cn]),
            );
            if (existing) {
              Object.assign(existing, state.conflict.set);
              out.push({ ...existing });
              continue;
            }
          }
          rows.push(row);
          out.push({ ...row });
        }
        return out;
      };
      const chain: Record<string, unknown> = {
        onConflictDoUpdate: (cfg: { target: { name: string }[]; set: Row }) => {
          state.conflict = cfg;
          return chain;
        },
        returning: () => ({
          then: (resolve: (v: Row[]) => void, reject: (e: unknown) => void) => {
            try {
              resolve(persist());
            } catch (e) {
              reject(e);
            }
          },
        }),
        then: (resolve: (v: Row[]) => void, reject: (e: unknown) => void) => {
          try {
            persist();
            resolve([]);
          } catch (e) {
            reject(e);
          }
        },
      };
      return chain;
    },
  });

  const updateBuilder = (table: object) => ({
    set: (patch: Row) => ({
      where: (cond: unknown) => {
        let updated: Row[] | null = null;
        const persist = (): Row[] => {
          if (updated) return updated;
          updated = [];
          for (const r of rowsFor(table)) {
            if (evalCondition(cond, r, table)) {
              for (const [key, value] of Object.entries(patch)) {
                r[key] = evalUpdateValue(value, r, table);
              }
              updated.push({ ...r });
            }
          }
          return updated;
        };
        const chain: Record<string, unknown> = {
          returning: (fields?: Record<string, { name: string }>) => ({
            then: (resolve: (v: Row[]) => void, reject: (e: unknown) => void) => {
              try {
                resolve(persist().map((row) => project(row, table, fields)));
              } catch (e) {
                reject(e);
              }
            },
          }),
          then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) => {
          try {
            resolve({ rowCount: persist().length });
          } catch (e) {
            reject(e);
          }
        },
        };
        return chain;
      },
    }),
  });

  const db = {
    select: (fields?: Record<string, { name: string }>) => selectBuilder(fields),
    insert: (table: object) => insertBuilder(table),
    update: (table: object) => updateBuilder(table),
    __table: (name: string): Row[] => {
      if (!tables.has(name)) tables.set(name, []);
      return tables.get(name) as Row[];
    },
  };
  return db as unknown as Db & FakeDb;
}

// --- fake OpenRouter -------------------------------------------------------
export class FakeOpenRouterClient implements OpenRouterClient {
  chatCalls: ChatOptions[] = [];
  imageCalls: ImageOptions[] = [];
  failImage = false;

  constructor(
    private readonly chatHandler?: (o: ChatOptions) => Promise<ChatResult>,
  ) {}

  isConfigured(): boolean {
    return true;
  }

  async chat(o: ChatOptions): Promise<ChatResult> {
    this.chatCalls.push(o);
    if (this.chatHandler) return this.chatHandler(o);
    return {
      content: '{}',
      model: o.model,
      usage: { tokensIn: 10, tokensOut: 20, costUsd: 0.001 },
      durationMs: 5,
    };
  }

  async generateImage(o: ImageOptions): Promise<ImageResult> {
    this.imageCalls.push(o);
    if (this.failImage) throw new Error('image generation failed');
    return {
      imageBase64: Buffer.from('fake-image-bytes').toString('base64'),
      mimeType: 'image/png',
      model: o.model,
      usage: { tokensIn: 0, tokensOut: 0, costUsd: 0.04 },
    };
  }

  async getModelInfo(id: string) {
    return { id, text: true, vision: false, image: true, jsonMode: true };
  }
}

export class FakeModelRouter implements ModelRouter {
  selected: TaskKind[] = [];

  async select(kind: TaskKind): Promise<string> {
    this.selected.push(kind);
    return `fake-${kind}-model`;
  }
}

// --- fake ports ------------------------------------------------------------
export interface FakeBudget extends BudgetPort {
  usages: Array<{
    model: string;
    tool: string;
    tokensIn: number;
    tokensOut: number;
    costUsd?: number;
    durationMs: number;
  }>;
  setAffordable(v: boolean): void;
}

export function createFakeBudget(
  affordable = true,
  reason = 'No budget',
): FakeBudget {
  const usages: FakeBudget['usages'] = [];
  let current = affordable;
  return {
    usages,
    setAffordable: (v: boolean) => {
      current = v;
    },
    checkAffordable: async () =>
      current ? { ok: true } : { ok: false, reason },
    recordUsage: async (u) => {
      usages.push(u);
    },
  };
}

export interface FakeStorage extends StoragePort {
  files: Array<{
    assetId: string;
    name: string;
    mimeType: string;
    kind: string;
    sizeBytes: number;
  }>;
}

export function createFakeStorage(db?: Db & FakeDb): FakeStorage {
  const files: FakeStorage['files'] = [];
  let n = 0;
  return {
    files,
    saveFile: async (input) => {
      n += 1;
      const assetId = `asset-fake-${n}`;
      files.push({
        assetId,
        name: input.name,
        mimeType: input.mimeType,
        kind: input.kind,
        sizeBytes: input.data.length,
      });
      // Mimic a backend port that persists the asset row (unlinked).
      db?.__table('assets').push({
        id: assetId,
        workspaceId: 'w1',
        projectId: null,
        filename: input.name,
        originalName: input.name,
        mime: input.mimeType,
        sizeBytes: input.data.length,
        kind: input.kind,
        width: input.width ?? null,
        height: input.height ?? null,
        isDemo: false,
        createdAt: new Date(),
        updatedAt: null,
      });
      return { assetId, url: `https://storage.test/${assetId}` };
    },
  };
}

export interface FakeConversation extends ConversationPort {
  messages: Array<{
    conversationId: string;
    content: string;
    meta?: Record<string, unknown>;
  }>;
}

export function createFakeConversation(): FakeConversation {
  const messages: FakeConversation['messages'] = [];
  return {
    messages,
    appendAssistantMessage: async (conversationId, content, meta) => {
      messages.push({ conversationId, content, meta });
    },
  };
}

export function createFakeMemory(): {
  store: MemoryStore;
  project: Map<string, Record<string, unknown>>;
  user: Map<string, Record<string, unknown>>;
} {
  const project = new Map<string, Record<string, unknown>>();
  const user = new Map<string, Record<string, unknown>>();
  const store: MemoryStore = {
    getProjectMemory: async (projectId) => ({ ...(project.get(projectId) ?? {}) }),
    setProjectMemory: async (projectId, key, value) => {
      const m = project.get(projectId) ?? {};
      m[key] = value;
      project.set(projectId, m);
    },
    getUserMemory: async (userId) => ({ ...(user.get(userId) ?? {}) }),
    setUserMemory: async (userId, key, value) => {
      const m = user.get(userId) ?? {};
      m[key] = value;
      user.set(userId, m);
    },
  };
  return { store, project, user };
}

export interface FakeEmitter {
  events: Array<{
    runId: string;
    type: AgentEventType;
    payload: Record<string, unknown>;
    global: boolean;
  }>;
  makeEmit: (
    runId: string,
  ) => (type: AgentEventType, payload: Record<string, unknown>) => Promise<void>;
  emitGlobal: (
    runId: string,
    type: AgentEventType,
    payload: Record<string, unknown>,
  ) => Promise<void>;
}

export function createFakeEmitter(): FakeEmitter {
  const events: FakeEmitter['events'] = [];
  return {
    events,
    makeEmit:
      (runId: string) =>
      async (type: AgentEventType, payload: Record<string, unknown>) => {
        events.push({ runId, type, payload, global: false });
      },
    emitGlobal: async (
      runId: string,
      type: AgentEventType,
      payload: Record<string, unknown>,
    ) => {
      events.push({ runId, type, payload, global: true });
    },
  };
}
