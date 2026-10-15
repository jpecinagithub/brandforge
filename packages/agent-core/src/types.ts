/**
 * @brandforge/agent-core — public type contracts.
 *
 * Tool / context / port interfaces the orchestrator and the backend program
 * against. The OpenRouter shapes below (ORChatMessage … ModelRouter) mirror
 * EXACTLY the interfaces @brandforge/integrations is implementing in parallel
 * They are declared here structurally so that
 * agent-core compiles and is unit-testable now; the real classes from
 * @brandforge/integrations are assignable to them without adaptation, at
 * which point these declarations can be re-exported from there.
 */
import type { z } from 'zod';
import type { AgentEventType, ToolCategory, ToolName } from '@brandforge/shared';
import type { Db } from '@brandforge/database';

/** Registry contract; implemented by tools/registry.ts. */
export interface ToolRegistry {
  get(name: ToolName): AgentTool;
  list(): AgentTool[];
  names(): ToolName[];
}

// ---------------------------------------------------------------------------
// OpenRouter shapes (mirror of @brandforge/integrations — see note above)
// ---------------------------------------------------------------------------
export interface ORChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  model: string;
  messages: ORChatMessage[];
  maxTokens?: number;
  temperature?: number;
  jsonMode?: boolean;
  timeoutMs?: number;
}

export interface TokenUsage {
  tokensIn: number;
  tokensOut: number;
  costUsd?: number;
}

export interface ChatResult {
  content: string;
  model: string;
  usage: TokenUsage;
  durationMs: number;
}

export interface ImageOptions {
  model: string;
  prompt: string;
  aspectRatio?: '1:1' | '16:9' | '9:16' | '4:3';
  timeoutMs?: number;
}

export interface ImageResult {
  imageBase64: string;
  mimeType: string;
  model: string;
  usage: TokenUsage;
  revisedPrompt?: string;
}

export interface OpenRouterClient {
  isConfigured(): boolean;
  chat(o: ChatOptions): Promise<ChatResult>;
  generateImage(o: ImageOptions): Promise<ImageResult>;
  getModelInfo(
    id: string,
  ): Promise<{ id: string; text: boolean; vision: boolean; image: boolean; jsonMode: boolean } | null>;
}

export interface OpenRouterEnv {
  apiKey: string;
  baseUrl: string;
  textModel?: string;
  visionModel?: string;
  imageModel?: string;
  reviewModel?: string;
}

export type TaskKind = 'text' | 'vision' | 'image' | 'review' | 'plan';

/**
 * Structural mirror of the ModelRouter class in @brandforge/integrations.
 * Declared as an interface so the real class (constructor + select) is
 * assignable without adaptation.
 */
export interface ModelRouter {
  select(kind: TaskKind): Promise<string>;
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------
export interface ToolResult {
  ok: boolean;
  summary: string;
  data?: unknown;
  usage?: TokenUsage;
  costUsd?: number;
}

export interface AgentTool<TArgs = any> {
  name: ToolName;
  category: ToolCategory;
  description: string;
  schema: z.ZodTypeAny;
  estimateUsd(args: TArgs): number;
  execute(ctx: ToolContext, args: TArgs): Promise<ToolResult>;
}

export interface ToolContext {
  db: Db;
  userId: string;
  workspaceId: string;
  projectId: string;
  runId: string;
  stepId: string;
  language: 'en' | 'es';
  openrouter: OpenRouterClient;
  router: ModelRouter;
  emit(type: AgentEventType, payload: Record<string, unknown>): Promise<void>;
  budget: BudgetPort;
  storage: StoragePort;
  conversation: ConversationPort;
  memory: MemoryStore;
}

// ---------------------------------------------------------------------------
// Ports (implemented by the backend; faked in unit tests)
// ---------------------------------------------------------------------------
export interface BudgetPort {
  checkAffordable(
    estimatedUsd: number,
  ): Promise<{ ok: boolean; reason?: string }>;
  recordUsage(u: {
    model: string;
    tool: string;
    tokensIn: number;
    tokensOut: number;
    costUsd?: number;
    durationMs: number;
  }): Promise<void>;
}

export interface StoragePort {
  saveFile(input: {
    data: Buffer;
    mimeType: string;
    name: string;
    kind: string;
    width?: number;
    height?: number;
  }): Promise<{ assetId: string; url: string }>;
}

export interface ConversationPort {
  appendAssistantMessage(
    conversationId: string,
    content: string,
    meta?: Record<string, unknown>,
  ): Promise<void>;
}

export interface MemoryStore {
  getProjectMemory(projectId: string): Promise<Record<string, unknown>>;
  setProjectMemory(
    projectId: string,
    key: string,
    value: unknown,
    summary?: string,
  ): Promise<void>;
  getUserMemory(userId: string): Promise<Record<string, unknown>>;
  setUserMemory(userId: string, key: string, value: unknown): Promise<void>;
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------
export interface OrchestratorConfig {
  maxSteps: number;
  stepTimeoutMs: number;
  runTimeoutMs: number;
  defaultBudgetUsd: number;
  maxAttempts: number;
}

export interface PortFactories {
  makeEmit(
    runId: string,
  ): (type: AgentEventType, payload: Record<string, unknown>) => Promise<void>;
  makeBudget(p: { runId: string; workspaceId: string }): BudgetPort;
  makeStorage(p: { workspaceId: string }): StoragePort;
  makeConversation(): ConversationPort;
  makeMemory(): MemoryStore;
}

export interface OrchestratorDeps {
  db: Db;
  openrouter: OpenRouterClient;
  router: ModelRouter;
  registry: ToolRegistry;
  config: OrchestratorConfig;
  ports: PortFactories;
  emitGlobal: (
    runId: string,
    type: AgentEventType,
    payload: Record<string, unknown>,
  ) => Promise<void>;
}

