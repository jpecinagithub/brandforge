# @brandforge/integrations

OpenRouter HTTP client and model router. **Server-side only** — this package
must never be bundled for the browser.

## Hard rule

All model calls run on Oracle (API/worker), **never in the browser**. The key
lives in server env / the credential vault — never in `VITE_*` vars, never in
client bundles, never in git, never in logs or error messages.

## What it exports

- `createOpenRouterClient(env?)` / `readOpenRouterEnv(source?)` — build a
  client. The API key comes only from the environment (`OPENROUTER_API_KEY`).
- `client.chat({ model, messages, maxTokens?, temperature?, jsonMode?, timeoutMs? })`
  — `POST /chat/completions`. Retries 429/5xx up to 3 attempts (1s/2s/4s
  backoff, honours `Retry-After`); never retries 400/401/402/404.
  `jsonMode` sends `response_format: { type: 'json_object' }`.
- `client.generateImage({ model, prompt, aspectRatio?, timeoutMs? })` —
  chat/completions with `modalities: ['image','text']`; returns raw base64
  (no `data:` prefix) from `message.images[0]`.
- `client.getModelInfo(modelId)` — capability lookup via `GET /models`,
  cached in memory for 1h. Requires configuration (throws
  `AINotConfiguredError` otherwise, like every network method).
- `new ModelRouter(env, client?)` + `select('text'|'vision'|'image'|'review'|'plan')`
  — pick a model. Order: env override → verified static registry → live
  `/models` scan (cheapest capable first). Throws `NoCapableModelError`.
- Errors: `AINotConfiguredError`, `OpenRouterHttpError` (has `statusCode`),
  `NoCapableModelError`, plus the legacy `NotImplementedError`.

## Environment

| Var | Purpose |
| --- | --- |
| `OPENROUTER_API_KEY` | Server-side API key (Oracle only). Empty = not configured; every network method throws `AINotConfiguredError` without touching the network. |
| `OPENROUTER_BASE_URL` | Defaults to `https://openrouter.ai/api/v1`. |
| `OPENROUTER_TEXT_MODEL` | Override for `text` and `plan` kinds (empty = router decides). |
| `OPENROUTER_VISION_MODEL` | Override for `vision` kind (empty = router decides). |
| `OPENROUTER_IMAGE_MODEL` | Override for `image` kind (empty = router decides). |
| `OPENROUTER_REVIEW_MODEL` | Override for `review` kind (empty = falls back to the text model). |

Strategy, verified model table and cost policy: `docs/adr/0007-model-router.md`.

## Server-side usage

```ts
import { createOpenRouterClient, ModelRouter, readOpenRouterEnv } from '@brandforge/integrations';

const env = readOpenRouterEnv(); // reads process.env on the server
const client = createOpenRouterClient(env);
const model = await new ModelRouter(env, client).select('text');
const res = await client.chat({ model, messages: [{ role: 'user', content: 'hello' }] });
// res.usage.costUsd is set ONLY when the provider reports it — never estimated.
```
