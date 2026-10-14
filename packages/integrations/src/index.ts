/**
 * @brandforge/integrations — Phase 3: OpenRouter client (SERVER-SIDE ONLY).
 *
 * HARD RULE: OpenRouter is called exclusively from the API/worker running on
 * Oracle. This package must never be bundled for the browser. The API key
 * comes only from the server environment; it is never logged, never embedded
 * in error messages, and never returned to callers.
 *
 * Covers:
 *  - text chat (POST /chat/completions, optional JSON mode)
 *  - image generation via chat/completions with modalities ['image','text']
 *  - GET /models capability lookup (cached 1h in memory)
 *  - ModelRouter: env override > verified static registry > live /models scan
 */

export class NotImplementedError extends Error {
  constructor(feature: string) {
    super(`${feature} is not implemented yet (Phase 3)`);
    this.name = 'NotImplementedError';
  }
}

export class AINotConfiguredError extends Error {
  constructor() {
    super(
      'OpenRouter is not configured: set OPENROUTER_API_KEY in the server environment ' +
        '(Oracle API/worker). No network request was attempted.',
    );
    this.name = 'AINotConfiguredError';
  }
}

export class NoCapableModelError extends Error {
  constructor(kind: string) {
    super(
      `No capable OpenRouter model found for task kind "${kind}" ` +
        '(checked env override, verified registry and the live /models catalog).',
    );
    this.name = 'NoCapableModelError';
  }
}

export class OpenRouterHttpError extends Error {
  readonly statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'OpenRouterHttpError';
    this.statusCode = statusCode;
  }
}

/* ------------------------------------------------------------------ types */

export interface ORChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Backwards-compatible alias for the Phase 1–2 ChatMessage shape. */
export type ChatMessage = ORChatMessage;

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
  /** Only set when the provider reports data.usage.cost. Never estimated. */
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
  /** Raw base64 payload, WITHOUT the data: URL prefix. */
  imageBase64: string;
  mimeType: string;
  model: string;
  usage: TokenUsage;
  revisedPrompt?: string;
}

export interface ModelInfo {
  id: string;
  text: boolean;
  vision: boolean;
  image: boolean;
  jsonMode: boolean;
}

export interface OpenRouterEnv {
  apiKey: string;
  baseUrl: string;
  textModel?: string;
  visionModel?: string;
  imageModel?: string;
  reviewModel?: string;
}

export interface OpenRouterClient {
  isConfigured(): boolean;
  chat(opts: ChatOptions): Promise<ChatResult>;
  generateImage(opts: ImageOptions): Promise<ImageResult>;
  getModelInfo(modelId: string): Promise<ModelInfo | null>;
}

export type TaskKind = 'text' | 'vision' | 'image' | 'review' | 'plan';

/* ------------------------------------------------------------------ consts */

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_TIMEOUT_MS = 120000;
const MODELS_TIMEOUT_MS = 30000;
const MODELS_CACHE_TTL_MS = 3600000; // 1h
const MAX_ATTEMPTS = 3;
const HTTP_REFERER = 'https://brandforge.local';
const X_TITLE = 'BrandForge AI';

/**
 * TEST-ONLY: overrideable timers for unit tests so the retry backoff does not
 * stall the suite. Never touch in production code.
 */
export const __testHooks = {
  sleep: (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms)),
};

/* ------------------------------------------------------------- env reading */

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function readOpenRouterEnv(source?: Record<string, string | undefined>): OpenRouterEnv {
  const s = source ?? (typeof process !== 'undefined' ? process.env : {});
  const baseUrl = (nonEmpty(s['OPENROUTER_BASE_URL']) ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  return {
    apiKey: s['OPENROUTER_API_KEY']?.trim() ?? '',
    baseUrl,
    textModel: nonEmpty(s['OPENROUTER_TEXT_MODEL']),
    visionModel: nonEmpty(s['OPENROUTER_VISION_MODEL']),
    imageModel: nonEmpty(s['OPENROUTER_IMAGE_MODEL']),
    reviewModel: nonEmpty(s['OPENROUTER_REVIEW_MODEL']),
  };
}

/* ------------------------------------------------------------ http helpers */

type JsonRecord = Record<string, unknown>;

interface CatalogModel {
  id: string;
  canonical_slug?: string;
  architecture?: {
    input_modalities?: string[];
    output_modalities?: string[];
  };
  supported_parameters?: string[];
  pricing?: {
    prompt?: string;
    completion?: string;
  };
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

/** Exponential backoff 1s/2s/4s between attempts; honours Retry-After. */
function retryDelayMs(failedAttempt: number, retryAfterHeader: string | null): number {
  if (retryAfterHeader) {
    const seconds = Number(retryAfterHeader.trim());
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1000, 60000);
    }
  }
  return Math.min(1000 * 2 ** (failedAttempt - 1), 8000);
}

async function readProviderErrorMessage(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as JsonRecord;
    const error = data['error'];
    if (error && typeof error === 'object') {
      const message = (error as JsonRecord)['message'];
      if (typeof message === 'string' && message.length > 0) return message;
    }
  } catch {
    /* ignore — fall through to the generic message */
  }
  return 'no further details from provider';
}

function extractTextContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (part && typeof part === 'object' && 'text' in part) {
          const text = (part as { text?: unknown }).text;
          return typeof text === 'string' ? text : '';
        }
        return '';
      })
      .join('');
  }
  return '';
}

function parseUsage(data: JsonRecord): TokenUsage {
  const usage = data['usage'];
  const tokensIn = usage && typeof usage === 'object' ? Number((usage as JsonRecord)['prompt_tokens']) : NaN;
  const tokensOut = usage && typeof usage === 'object' ? Number((usage as JsonRecord)['completion_tokens']) : NaN;
  const result: TokenUsage = {
    tokensIn: Number.isFinite(tokensIn) ? (tokensIn as number) : 0,
    tokensOut: Number.isFinite(tokensOut) ? (tokensOut as number) : 0,
  };
  // costUsd is set ONLY when the provider reports data.usage.cost as a number.
  // We never estimate or invent prices (see docs/adr/0007-model-router.md).
  if (usage && typeof usage === 'object') {
    const cost = (usage as JsonRecord)['cost'];
    if (typeof cost === 'number' && Number.isFinite(cost)) result.costUsd = cost;
  }
  return result;
}

/** Accepts OpenRouter's {image_url:{url}} and b64_json payload shapes. */
function imagePayloadUrl(entry: unknown): string | undefined {
  if (!entry || typeof entry !== 'object') return undefined;
  const e = entry as JsonRecord;
  const nested = e['image_url'] ?? e['imageUrl'];
  if (nested && typeof nested === 'object') {
    const url = (nested as JsonRecord)['url'];
    if (typeof url === 'string' && url.length > 0) return url;
  }
  const b64 = e['b64_json'] ?? e['b64Json'];
  if (typeof b64 === 'string' && b64.length > 0) return b64;
  return undefined;
}

function splitDataUrl(url: string): { base64: string; mimeType: string } {
  if (url.startsWith('data:')) {
    const comma = url.indexOf(',');
    const meta = comma > 0 ? url.slice(5, comma) : '';
    const mimeType = meta.split(';')[0]?.trim() || 'image/png';
    return { base64: comma > 0 ? url.slice(comma + 1) : '', mimeType };
  }
  // Raw base64 without a data: prefix — assume PNG (documented behaviour).
  return { base64: url, mimeType: 'image/png' };
}

/* ----------------------------------------------------------------- client */

class HttpOpenRouterClient implements OpenRouterClient {
  private readonly env: OpenRouterEnv;
  private modelsCache: { fetchedAt: number; data: CatalogModel[] } | null = null;

  constructor(env: OpenRouterEnv) {
    this.env = env;
  }

  isConfigured(): boolean {
    return this.env.apiKey.trim().length > 0;
  }

  private assertConfigured(): void {
    if (!this.isConfigured()) throw new AINotConfiguredError();
  }

  private async request(method: 'GET' | 'POST', path: string, body: unknown, timeoutMs: number): Promise<JsonRecord> {
    const url = `${this.env.baseUrl}${path}`;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new DOMException(`OpenRouter request timed out after ${timeoutMs} ms`, 'AbortError'));
          }, timeoutMs);
        });
        const headers: Record<string, string> = {
          Authorization: `Bearer ${this.env.apiKey}`,
          'HTTP-Referer': HTTP_REFERER,
          'X-Title': X_TITLE,
        };
        const init: RequestInit = { method, headers, signal: controller.signal };
        if (method === 'POST') {
          headers['Content-Type'] = 'application/json';
          init.body = JSON.stringify(body);
        }
        const res = await Promise.race([fetch(url, init), timeout]);
        if (res.ok) {
          return (await res.json()) as JsonRecord;
        }
        if (isRetryableStatus(res.status) && attempt < MAX_ATTEMPTS) {
          const retryAfter = res.headers.get('retry-after');
          await res.arrayBuffer().catch(() => undefined); // drain so the socket can be reused
          await __testHooks.sleep(retryDelayMs(attempt, retryAfter));
          continue;
        }
        throw new OpenRouterHttpError(
          res.status,
          `OpenRouter request failed (HTTP ${res.status}): ${await readProviderErrorMessage(res)}`,
        );
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
    throw new Error('unreachable: retry loop always returns or throws');
  }

  async chat(opts: ChatOptions): Promise<ChatResult> {
    this.assertConfigured();
    const body: JsonRecord = { model: opts.model, messages: opts.messages };
    if (opts.maxTokens !== undefined) body['max_tokens'] = opts.maxTokens;
    if (opts.temperature !== undefined) body['temperature'] = opts.temperature;
    if (opts.jsonMode) body['response_format'] = { type: 'json_object' };

    const startedAt = Date.now();
    const data = await this.request('POST', '/chat/completions', body, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const durationMs = Date.now() - startedAt;

    const choices = data['choices'];
    const message =
      Array.isArray(choices) && choices.length > 0 && choices[0] && typeof choices[0] === 'object'
        ? ((choices[0] as JsonRecord)['message'] as JsonRecord | undefined)
        : undefined;
    const content = extractTextContent(message?.['content']);
    if (!content) {
      throw new Error(`OpenRouter returned an empty completion for model "${opts.model}".`);
    }
    const model = typeof data['model'] === 'string' ? data['model'] : opts.model;
    return { content, model: model as string, usage: parseUsage(data), durationMs };
  }

  async generateImage(opts: ImageOptions): Promise<ImageResult> {
    this.assertConfigured();
    const body: JsonRecord = {
      model: opts.model,
      messages: [{ role: 'user', content: opts.prompt }],
      modalities: ['image', 'text'],
    };
    if (opts.aspectRatio) {
      // Documented OpenRouter parameter; models that do not support it ignore it.
      body['image_config'] = { aspect_ratio: opts.aspectRatio };
    }

    const data = await this.request('POST', '/chat/completions', body, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const choices = data['choices'];
    const message =
      Array.isArray(choices) && choices.length > 0 && choices[0] && typeof choices[0] === 'object'
        ? ((choices[0] as JsonRecord)['message'] as JsonRecord | undefined)
        : undefined;
    const images = message?.['images'];
    if (!Array.isArray(images) || images.length === 0) {
      throw new Error(
        `OpenRouter model "${opts.model}" returned no image ` +
          '(expected choices[0].message.images[0]; the model may not support image output).',
      );
    }
    const url = imagePayloadUrl(images[0]);
    if (!url) {
      throw new Error(
        `OpenRouter model "${opts.model}" returned an image entry in an unrecognized shape ` +
          '(expected {image_url:{url}} or b64_json).',
      );
    }
    const { base64, mimeType } = splitDataUrl(url);
    if (!base64) {
      throw new Error(`OpenRouter model "${opts.model}" returned an empty image payload.`);
    }
    const revised = extractTextContent(message?.['content']);
    const model = typeof data['model'] === 'string' ? (data['model'] as string) : opts.model;
    const result: ImageResult = {
      imageBase64: base64,
      mimeType,
      model,
      usage: parseUsage(data),
    };
    if (revised) result.revisedPrompt = revised;
    return result;
  }

  private async catalog(): Promise<CatalogModel[]> {
    const now = Date.now();
    if (this.modelsCache && now - this.modelsCache.fetchedAt < MODELS_CACHE_TTL_MS) {
      return this.modelsCache.data;
    }
    const data = await this.request('GET', '/models', undefined, MODELS_TIMEOUT_MS);
    const raw = data['data'];
    const models = Array.isArray(raw) ? (raw as CatalogModel[]) : [];
    this.modelsCache = { fetchedAt: now, data: models };
    return models;
  }

  /** Internal catalog accessor used by ModelRouter's live fallback (step 3). */
  async listCatalogModels(): Promise<CatalogModel[]> {
    this.assertConfigured();
    return this.catalog();
  }

  async getModelInfo(modelId: string): Promise<ModelInfo | null> {
    this.assertConfigured();
    const entry = (await this.catalog()).find((m) => m.id === modelId || m.canonical_slug === modelId);
    if (!entry) return null;
    return mapCatalogModel(entry);
  }
}

function mapCatalogModel(m: CatalogModel): ModelInfo {
  const arch = m.architecture ?? {};
  const input = Array.isArray(arch.input_modalities) ? arch.input_modalities : [];
  const output = Array.isArray(arch.output_modalities) ? arch.output_modalities : [];
  const params = m.supported_parameters;
  return {
    id: m.id,
    text: output.includes('text'),
    vision: input.includes('image'),
    image: output.includes('image'),
    // If the provider does not report supported_parameters, assume JSON mode
    // works unless there is evidence to the contrary.
    jsonMode: params === undefined ? true : params.includes('response_format'),
  };
}

export function createOpenRouterClient(env?: Partial<OpenRouterEnv>): OpenRouterClient {
  const fromProcess = readOpenRouterEnv();
  return new HttpOpenRouterClient({
    apiKey: nonEmpty(env?.apiKey) ?? fromProcess.apiKey,
    baseUrl: nonEmpty(env?.baseUrl)?.replace(/\/+$/, '') ?? fromProcess.baseUrl,
    textModel: nonEmpty(env?.textModel) ?? fromProcess.textModel,
    visionModel: nonEmpty(env?.visionModel) ?? fromProcess.visionModel,
    imageModel: nonEmpty(env?.imageModel) ?? fromProcess.imageModel,
    reviewModel: nonEmpty(env?.reviewModel) ?? fromProcess.reviewModel,
  });
}

/* -------------------------------------------------------------- model router */

interface StaticCandidate {
  id: string;
  text: boolean;
  vision: boolean;
  image: boolean;
}

/**
 * Registry of models whose capabilities were VERIFIED against OpenRouter's
 * docs / live /models data (see docs/adr/0007-model-router.md). Only models
 * verified there may be listed here — never invent entries.
 */
const STATIC_REGISTRY: StaticCandidate[] = [
  { id: 'google/gemini-2.5-flash', text: true, vision: true, image: false },
  { id: 'google/gemini-2.5-flash-lite', text: true, vision: true, image: false },
  { id: 'google/gemini-2.5-flash-image-preview', text: true, vision: true, image: true },
  { id: 'google/gemini-2.5-flash-image', text: true, vision: true, image: true },
];

/** Ordered preference per task kind (index 0 = preferred default). */
const KIND_PREFERENCE: Record<TaskKind, string[]> = {
  text: ['google/gemini-2.5-flash', 'google/gemini-2.5-flash-lite'],
  vision: ['google/gemini-2.5-flash', 'google/gemini-2.5-flash-lite'],
  image: ['google/gemini-2.5-flash-image-preview', 'google/gemini-2.5-flash-image'],
  review: ['google/gemini-2.5-flash', 'google/gemini-2.5-flash-lite'],
  plan: ['google/gemini-2.5-flash', 'google/gemini-2.5-flash-lite'],
};

function envOverrideForKind(env: OpenRouterEnv, kind: TaskKind): string | undefined {
  switch (kind) {
    case 'text':
    case 'plan':
      return env.textModel;
    case 'vision':
      return env.visionModel;
    case 'image':
      return env.imageModel;
    case 'review':
      // A review pass can reuse the text model; a dedicated override wins.
      return env.reviewModel ?? env.textModel;
  }
}

function matchesKind(caps: { text: boolean; vision: boolean; image: boolean }, kind: TaskKind): boolean {
  switch (kind) {
    case 'text':
    case 'review':
    case 'plan':
      return caps.text;
    case 'vision':
      return caps.vision;
    case 'image':
      return caps.image;
  }
}

function promptPricePerToken(m: CatalogModel): number {
  const raw = m.pricing?.prompt;
  const value = typeof raw === 'string' ? Number(raw) : NaN;
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}

export class ModelRouter {
  constructor(
    private readonly env: OpenRouterEnv,
    private readonly client?: OpenRouterClient,
  ) {}

  private getClient(): OpenRouterClient {
    return this.client ?? createOpenRouterClient(this.env);
  }

  /**
   * Selection order:
   *  1. env override (OPENROUTER_*_MODEL; 'plan' uses the text model,
   *     'review' falls back to the text model). Explicit user choice wins —
   *     returned without any network call.
   *  2. verified static registry; when the client is configured the candidate
   *     is confirmed against the live catalog first (fail-open: if the catalog
   *     is unreachable, the verified static entry is trusted).
   *  3. live /models scan: cheapest capable model by prompt price.
   * Throws NoCapableModelError when nothing matches.
   */
  async select(kind: TaskKind): Promise<string> {
    const override = envOverrideForKind(this.env, kind);
    if (override) return override;

    const client = this.getClient();
    const preference = KIND_PREFERENCE[kind]
      .map((id) => STATIC_REGISTRY.find((c) => c.id === id))
      .filter((c): c is StaticCandidate => c !== undefined);

    if (client.isConfigured()) {
      for (const candidate of preference) {
        let info: ModelInfo | null;
        try {
          info = await client.getModelInfo(candidate.id);
        } catch {
          // Catalog unreachable — trust the verified static registry.
          return candidate.id;
        }
        if (info && matchesKind(info, kind)) return info.id;
      }

      // Step 3: live scan. Only the bundled HTTP client exposes the catalog;
      // injected doubles simply skip this step.
      const maybeInternal = client as unknown as {
        listCatalogModels?: () => Promise<CatalogModel[]>;
      };
      if (typeof maybeInternal.listCatalogModels === 'function') {
        const catalog = await maybeInternal.listCatalogModels();
        const capable = catalog
          .filter((m) => matchesKind(mapCatalogModel(m), kind))
          .sort((a, b) => promptPricePerToken(a) - promptPricePerToken(b));
        if (capable.length > 0) return capable[0].id;
      }
    } else if (preference.length > 0) {
      // Not configured: no network at all — return the verified default.
      return preference[0].id;
    }

    throw new NoCapableModelError(kind);
  }
}
