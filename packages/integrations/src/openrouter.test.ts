/**
 * Unit: OpenRouter client + ModelRouter (Phase 3).
 *
 * All `fetch` calls below are TEST-ONLY mocks — no real network traffic, no
 * API key, no billing is possible from this suite. The "not configured" cases
 * assert that fetch is never even touched.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AINotConfiguredError,
  ModelRouter,
  NoCapableModelError,
  OpenRouterClient,
  OpenRouterHttpError,
  __testHooks,
  createOpenRouterClient,
  readOpenRouterEnv,
} from './index.js';

const configuredEnv = { ...readOpenRouterEnv({}), apiKey: 'test-key-only' };
const unconfiguredEnv = { ...readOpenRouterEnv({}), apiKey: '' };

function okJson(payload: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    json: async () => payload,
    arrayBuffer: async () => new ArrayBuffer(0),
  } as unknown as Response;
}

function errJson(status: number, payload: unknown, retryAfter?: string): Response {
  const headers = new Headers();
  if (retryAfter) headers.set('retry-after', retryAfter);
  return {
    ok: false,
    status,
    headers,
    json: async () => payload,
    arrayBuffer: async () => new ArrayBuffer(0),
  } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;
let originalSleep: (ms: number) => Promise<void>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  originalSleep = __testHooks.sleep;
});

afterEach(() => {
  vi.unstubAllGlobals();
  __testHooks.sleep = originalSleep;
});

function requestInit(): RequestInit {
  const call = fetchMock.mock.calls[0];
  expect(call).toBeDefined();
  return call[1] as RequestInit;
}

function requestBody(): Record<string, unknown> {
  const init = requestInit();
  return JSON.parse(String(init.body)) as Record<string, unknown>;
}

describe('not configured', () => {
  it('(a) throws AINotConfiguredError without any network call', async () => {
    const client = createOpenRouterClient(unconfiguredEnv);
    expect(client.isConfigured()).toBe(false);

    await expect(client.chat({ model: 'x/y', messages: [] })).rejects.toBeInstanceOf(AINotConfiguredError);
    await expect(client.generateImage({ model: 'x/y', prompt: 'p' })).rejects.toBeInstanceOf(
      AINotConfiguredError,
    );
    await expect(client.getModelInfo('x/y')).rejects.toBeInstanceOf(AINotConfiguredError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('readOpenRouterEnv defaults baseUrl and trims values', () => {
    const env = readOpenRouterEnv({ OPENROUTER_API_KEY: '  k  ', OPENROUTER_TEXT_MODEL: '   ' });
    expect(env.apiKey).toBe('k');
    expect(env.baseUrl).toBe('https://openrouter.ai/api/v1');
    expect(env.textModel).toBeUndefined();
  });
});

describe('chat', () => {
  it('(b) parses content, usage and provider-reported cost', async () => {
    fetchMock.mockResolvedValue(
      okJson({
        model: 'google/gemini-2.5-flash',
        choices: [{ message: { role: 'assistant', content: 'hola' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.0000125 },
      }),
    );
    const client = createOpenRouterClient(configuredEnv);
    const res = await client.chat({ model: 'google/gemini-2.5-flash', messages: [{ role: 'user', content: 'hi' }] });

    expect(res.content).toBe('hola');
    expect(res.model).toBe('google/gemini-2.5-flash');
    expect(res.usage.tokensIn).toBe(10);
    expect(res.usage.tokensOut).toBe(5);
    expect(res.usage.costUsd).toBe(0.0000125);
    expect(res.durationMs).toBeGreaterThanOrEqual(0);

    const init = requestInit();
    expect(fetchMock.mock.calls[0][0]).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer test-key-only');
    expect(headers['HTTP-Referer']).toBe('https://brandforge.local');
    expect(headers['X-Title']).toBe('BrandForge AI');
    expect(requestBody()).toMatchObject({
      model: 'google/gemini-2.5-flash',
      messages: [{ role: 'user', content: 'hi' }],
    });
  });

  it('omits costUsd when the provider does not report a cost', async () => {
    fetchMock.mockResolvedValue(
      okJson({
        model: 'm',
        choices: [{ message: { role: 'assistant', content: 'x' } }],
        usage: { prompt_tokens: 1, completion_tokens: 2 },
      }),
    );
    const res = await createOpenRouterClient(configuredEnv).chat({ model: 'm', messages: [] });
    expect(res.usage.costUsd).toBeUndefined();
  });

  it('sends response_format when jsonMode is true', async () => {
    fetchMock.mockResolvedValue(
      okJson({ model: 'm', choices: [{ message: { content: '{"a":1}' } }], usage: {} }),
    );
    await createOpenRouterClient(configuredEnv).chat({ model: 'm', messages: [], jsonMode: true });
    expect(requestBody()['response_format']).toEqual({ type: 'json_object' });
  });

  it('(c) retries once on 429 and then succeeds', async () => {
    const sleeps: number[] = [];
    __testHooks.sleep = (ms: number) => {
      sleeps.push(ms);
      return Promise.resolve();
    };
    fetchMock
      .mockResolvedValueOnce(errJson(429, { error: { message: 'rate limited' } }, '2'))
      .mockResolvedValueOnce(
        okJson({ model: 'm', choices: [{ message: { content: 'recovered' } }], usage: {} }),
      );

    const res = await createOpenRouterClient(configuredEnv).chat({ model: 'm', messages: [] });
    expect(res.content).toBe('recovered');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Retry-After: 2 wins over the exponential backoff.
    expect(sleeps).toEqual([2000]);
  });

  it('(d) 401 throws OpenRouterHttpError without retrying', async () => {
    fetchMock.mockResolvedValue(errJson(401, { error: { message: 'Invalid API key' } }));
    const err = await createOpenRouterClient(configuredEnv)
      .chat({ model: 'm', messages: [] })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(OpenRouterHttpError);
    expect((err as OpenRouterHttpError).statusCode).toBe(401);
    expect((err as Error).message).toContain('Invalid API key');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('(e) timeout surfaces an AbortError', async () => {
    fetchMock.mockImplementation(() => new Promise(() => {})); // never settles
    const err = await createOpenRouterClient(configuredEnv)
      .chat({ model: 'm', messages: [], timeoutMs: 30 })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(DOMException);
    expect((err as DOMException).name).toBe('AbortError');
  });
});

describe('getModelInfo', () => {
  const catalogPayload = {
    data: [
      {
        id: 'google/gemini-2.5-flash',
        canonical_slug: 'google/gemini-2.5-flash',
        architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
        supported_parameters: ['response_format', 'temperature', 'max_tokens'],
      },
      {
        id: 'some/text-only',
        architecture: { input_modalities: ['text'], output_modalities: ['text'] },
        // no supported_parameters -> jsonMode defaults to true
      },
    ],
  };

  it('maps architecture to capabilities and caches the catalog for 1h', async () => {
    fetchMock.mockResolvedValue(okJson(catalogPayload));
    const client = createOpenRouterClient(configuredEnv);

    const info = await client.getModelInfo('google/gemini-2.5-flash');
    expect(info).toMatchObject({ id: 'google/gemini-2.5-flash', text: true, vision: true, image: false, jsonMode: true });

    const fallback = await client.getModelInfo('some/text-only');
    expect(fallback).toMatchObject({ text: true, vision: false, image: false, jsonMode: true });

    expect(await client.getModelInfo('does/not-exist')).toBeNull();
    // All three lookups served from a single GET /models.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://openrouter.ai/api/v1/models');
  });
});

describe('generateImage', () => {
  it('(h) extracts base64 from message.images[0] and strips the data: prefix', async () => {
    fetchMock.mockResolvedValue(
      okJson({
        model: 'google/gemini-2.5-flash-image-preview',
        choices: [
          {
            message: {
              content: 'revised prompt text',
              images: [{ image_url: { url: 'data:image/png;base64,QUJDRA==' } }],
            },
          },
        ],
        usage: { prompt_tokens: 12, completion_tokens: 300 },
      }),
    );
    const client = createOpenRouterClient(configuredEnv);
    const res = await client.generateImage({ model: 'google/gemini-2.5-flash-image-preview', prompt: 'a cat' });

    expect(res.imageBase64).toBe('QUJDRA==');
    expect(res.mimeType).toBe('image/png');
    expect(res.revisedPrompt).toBe('revised prompt text');
    expect(res.usage.tokensIn).toBe(12);

    const body = requestBody();
    expect(body['modalities']).toEqual(['image', 'text']);
    expect((body['messages'] as Array<{ content: string }>)[0].content).toBe('a cat');
  });

  it('throws a clear error when the model returns no image', async () => {
    fetchMock.mockResolvedValue(
      okJson({ model: 'm', choices: [{ message: { content: 'just text' } }], usage: {} }),
    );
    const err = await createOpenRouterClient(configuredEnv)
      .generateImage({ model: 'm', prompt: 'p' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/returned no image/);
  });
});

describe('ModelRouter', () => {
  it('(f) env override wins and performs no network call', async () => {
    const router = new ModelRouter({ ...configuredEnv, textModel: 'custom/text-model' });
    await expect(router.select('text')).resolves.toBe('custom/text-model');
    await expect(router.select('plan')).resolves.toBe('custom/text-model');
    await expect(router.select('review')).resolves.toBe('custom/text-model');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns the verified static default without network when unconfigured', async () => {
    const router = new ModelRouter(unconfiguredEnv);
    await expect(router.select('text')).resolves.toBe('google/gemini-2.5-flash');
    await expect(router.select('image')).resolves.toBe('google/gemini-2.5-flash-image-preview');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('confirms static candidates against the live catalog when configured', async () => {
    fetchMock.mockResolvedValue(
      okJson({
        data: [
          {
            id: 'google/gemini-2.5-flash',
            architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
            supported_parameters: ['response_format'],
          },
        ],
      }),
    );
    const router = new ModelRouter(configuredEnv);
    await expect(router.select('vision')).resolves.toBe('google/gemini-2.5-flash');
    expect(fetchMock).toHaveBeenCalledTimes(1); // single cached GET /models
  });

  it('(g) throws NoCapableModelError when no candidate is capable', async () => {
    const fakeClient = {
      isConfigured: () => true,
      chat: vi.fn(),
      generateImage: vi.fn(),
      getModelInfo: vi.fn().mockResolvedValue(null),
    } as unknown as OpenRouterClient;
    const router = new ModelRouter(configuredEnv, fakeClient);
    await expect(router.select('image')).rejects.toBeInstanceOf(NoCapableModelError);
    await expect(router.select('text')).rejects.toBeInstanceOf(NoCapableModelError);
  });
});
