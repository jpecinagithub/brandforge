# ADR-0007 — Phase 3: OpenRouter client, verified model registry, selection strategy, cost policy

Date: 2026-10-14 · Status: accepted · Package: `@brandforge/integrations`

## Context

Phase 3's orchestrator plans and executes marketing work via OpenRouter. We
need a server-side client, a deterministic way to pick models per task kind,
and an honest cost policy. Model availability and pricing change constantly,
so the design must prefer explicit configuration, fall back to verified
knowledge, and only then probe the live catalog — never guess.

## Decision 1 — server-side client, key from env only

OpenRouter is called exclusively from the API/worker on Oracle. The client in
`packages/integrations` uses the global `fetch` (no new runtime
dependencies) and must never be bundled for the browser. The API key comes
only from `OPENROUTER_API_KEY`; it is never logged, never embedded in error
messages, and never returned to callers. Every method that needs the network
throws `AINotConfiguredError` *without* any network call when the key is
missing — so misconfiguration fails closed and free.

Transport behaviour:

- `chat()`: `POST {baseUrl}/chat/completions` with `Authorization: Bearer`,
  `HTTP-Referer: https://brandforge.local`, `X-Title: BrandForge AI`.
  `response_format: { type: 'json_object' }` when `jsonMode` is set. Default
  timeout 120 s via `AbortController`.
- Retries: max 3 attempts, exponential backoff 1 s / 2 s / 4 s, retrying only
  429 and 5xx while honouring `Retry-After`. Never retries 400/401/402/404 —
  those are caller problems, and retrying them would only burn quota.
- Timeouts surface as `AbortError`; HTTP errors as `OpenRouterHttpError`
  carrying `statusCode`.
- `generateImage()`: chat/completions with `modalities: ['image','text']` and
  the image extracted from `choices[0].message.images[0]` (accepting both the
  documented `{image_url:{url}}` shape and `b64_json`). Returns raw base64
  without the `data:` prefix. Optional `image_config.aspect_ratio` is sent
  when requested.
- `getModelInfo()`: `GET {baseUrl}/models`, cached in memory for 1 h, mapping
  `architecture.input_modalities` / `output_modalities` / `supported_parameters`
  to `{ text, vision, image, jsonMode }`. `jsonMode` defaults to `true` when
  the provider omits `supported_parameters`, unless there is evidence against.

## Decision 2 — selection order: env override > verified registry > live scan

`ModelRouter.select(kind)` resolves in this order:

1. **Env override** — `OPENROUTER_TEXT_MODEL` / `_VISION_MODEL` /
   `_IMAGE_MODEL` / `_REVIEW_MODEL`. `'plan'` uses the text model; `'review'`
   falls back to the text model. An explicit override is returned with zero
   network calls — the operator's choice is always final.
2. **Verified static registry** — models whose capabilities were verified
   against OpenRouter's docs and live `/models` data (table below). When the
   client is configured, each candidate is confirmed via `getModelInfo()`
   (fail-open: if the catalog is unreachable, the verified entry is trusted).
   When unconfigured, the preferred static default is returned with no network.
3. **Live `/models` scan** — filter by capability, pick the cheapest capable
   model by prompt price. Last resort; deterministic.

If nothing matches, `select()` throws `NoCapableModelError`.

## Decision 3 — verified model registry (2026-10-14)

Only models verified below may appear in `STATIC_REGISTRY`. Everything else
must come from an explicit env override or the live scan.

| Model | text | vision | image | jsonMode | Notes / verified by |
| --- | --- | --- | --- | --- | --- |
| `google/gemini-2.5-flash` | ✓ | ✓ | — | ✓ | Live `/models` record: input `text+image+file`, output `text`, `supported_parameters` includes `response_format`. Good cheap default for text + vision. |
| `google/gemini-2.5-flash-lite` | ✓ | ✓ | — | n/a (not asserted) | Live `/models` record: input includes `image`, output `text`; cheaper tier than Flash. |
| `google/gemini-2.5-flash-image-preview` | ✓ | ✓ | ✓ | n/a (not asserted) | OpenRouter's own image-generation docs use it as the canonical example with `modalities: ['image','text']` and `message.images[*].image_url.url` as base64 data URLs. Preferred image default. |
| `google/gemini-2.5-flash-image` | ✓ | ✓ | — | n/a (not asserted) | Image output verified end-to-end against the live OpenRouter API by an independent integration (generate + edit). Fallback image model. |

Sources consulted 2026-10-14:

- OpenRouter image-generation docs (mirrors):
  https://github.com/rfxlamia/openrouter-docs/blob/HEAD/multimodal/image-generation.md
- OpenRouter models-endpoint reference (mirrors):
  https://github.com/rfxlamia/openrouter-docs/blob/HEAD/models.md
- OpenRouter image-model research (June 2026):
  https://github.com/maxschoon/imagegenstudio/blob/HEAD/docs/openrouter-image-model-research.md
- Live end-to-end verification of `google/gemini-2.5-flash-image` via OpenRouter:
  https://github.com/hex/claude-image-generation/commit/3d3dca40f80138cc62c10fc326c96b75704c6a8c
- Cheap text/vision picks:
  https://github.com/ciberjohn/hermes-skills/blob/HEAD/openrouter-image-gen/SKILL.md
  and https://github.com/ai-degen-69/global-skills/blob/HEAD/hermes/hermes-model-optimization/SKILL.md

Deliberately excluded: Gemini 3.x image variants and other newer slugs were
mentioned in third-party research but not verified in OpenRouter's own docs —
per the "never invent" rule they are not in the registry (the live scan can
still discover them).

## Decision 4 — cost policy: only provider-reported numbers

- `ChatResult.usage.costUsd` / `ImageResult.usage.costUsd` are set **only**
  when the provider returns `data.usage.cost` as a number. We never estimate,
  extrapolate, or hardcode per-token prices.
- The live scan reads `pricing.prompt` from `/models` (USD per token, as
  strings) purely to rank candidates — never to report a cost.
- Absence of cost data is reported as absence (`costUsd` undefined), not as
  zero.

## Consequences

- The orchestrator can always get a model via env (deterministic in prod),
  verified defaults (deterministic offline), or live discovery (adaptive).
- Replacing a default = setting one env var; no code change, no redeploy of
  selection logic.
- Registry entries age: review this ADR when OpenRouter retires a listed model
  or when a cheaper verified alternative appears.
