# @brandforge/integrations

Phase 3: the OpenRouter HTTP client lives here. **Nothing here executes AI yet**
— `StubOpenRouterClient` throws `NotImplementedError` on every call.

## Environment (Phase 3)

| Var | Purpose |
| --- | --- |
| `OPENROUTER_API_KEY` | Server-side API key (Oracle only) |
| `OPENROUTER_BASE_URL` | Defaults to `https://openrouter.ai/api/v1` |
| `OPENROUTER_DEFAULT_MODEL` | Fallback model for the router |

## Hard rule

All model calls run on Oracle (API/worker), **never in the browser**.
Keys live in server env / the credential vault — never in `VITE_*` vars,
never in client bundles, never in git.
