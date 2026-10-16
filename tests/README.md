# BrandForge tests

Three layers. All of them run against throwaway resources — never the dev
`brandforge` database, never a real inbox, never a real AI provider.

## 1. Unit — `npm run test:unit` (vitest project `unit`)

Fast (<10s), no I/O:

| File | Covers |
|---|---|
| `apps/api/src/auth/password.test.ts` | argon2id hash/verify roundtrip, wrong password, malformed hash → `false`, unique salts |
| `apps/api/src/auth/tokens.test.ts` | `randomToken` shape/uniqueness, `sha256Hex` vector, expiry math |
| `apps/api/src/errors.test.ts` | `isUuid` guard (canonical/uppercase accept; junk reject) |
| `apps/api/src/authz.test.ts` | `roleAtLeast` ordering `viewer < editor < owner`, null → false |
| `apps/api/src/schemas.test.ts` | zod rejections: weak passwords, bad emails, blank names, oversized chat input |
| `apps/api/src/test-mail.test.ts` | quoted-printable token extraction (regression test — see below) |
| `packages/integrations/src/openrouter.test.ts` | OpenRouter client, retries, model routing, image responses and no-network behavior when unconfigured |

## 2. Integration — `npm run test:integration` (vitest project `integration`)

Fastify `inject` against a real Postgres. Requires:

```bash
# one-time setup
sudo -u postgres psql -c "CREATE DATABASE brandforge_test OWNER brandforge;"
cd ~/workspace/brandforge
DATABASE_URL=postgres://brandforge:brandforge_dev_pw@localhost:5432/brandforge_test \
  npm run db:migrate --workspace=@brandforge/database
```

The vitest config injects `DATABASE_URL` (→ `brandforge_test`), `MAILDIR_PATH=/tmp/bf-test-maildir`,
`STORAGE_PATH=/tmp/bf-test-storage` automatically. Each test truncates all tables in `beforeEach`.

| File | Covers |
|---|---|
| `apps/api/src/routes/auth.integration.test.ts` | register → verify (token from maildir) → login (cookie) → me → logout → 401; unverified login 403; wrong password 401; weak/bad/duplicate registration; UUID guard 400 |
| `apps/api/src/routes/recovery.integration.test.ts` | forgot-password neutral 200 for unknown emails (sends nothing); reset flow; bogus/reused token 400; reset revokes all sessions |
| `apps/api/src/routes/demo.integration.test.ts` | demo mints isolated user+workspace, seeds "Café Aroma — Christmas Campaign", demos can't see each other's (or real users') projects (404) |
| `apps/api/src/routes/projects.integration.test.ts` | project → campaign → brand kit → safe unconfigured-agent fallback; favorite toggle; asset upload; delete; non-member 404 |
| `apps/api/src/routes/agent.integration.test.ts` | durable agent runs, quotas, approvals, cancellation, events and configured/unconfigured paths |
| `apps/api/src/routes/ratelimit.integration.test.ts` | 21 rapid logins → 429 `RATE_LIMITED` on the 21st |

Run everything: `npm test` (= unit + integration).

### The maildir trick

`MAIL_TRANSPORT=maildir` makes the API write rendered emails as `.eml` files instead of
sending them. Tests read the newest file and extract the `token=<redacted> link.

⚠️ The `.eml` is **quoted-printable**: the `=` in `?token=` is escaped as `=3D` and long
lines are folded with soft breaks. `apps/api/src/test-mail.ts` QP-decodes before extracting —
a naive regex glues the `3D` onto the token and verification fails with `INVALID_TOKEN`
(this exact bug was caught while writing the suite; `test-mail.test.ts` pins the fix).

### The OpenRouter mock

`tests/mocks/openrouter.mock.ts` is a **TEST DOUBLE, never billed**: a fake
`OpenRouterClient` returning a canned reply. The integration suite additionally
replaces global `fetch` with a throwing recorder
(`tests/setup/no-network.ts`) — any external HTTP attempt fails the run loudly.

## 3. E2E — `npm run test:e2e` (Playwright, Chromium headless)

Drives the real UI against the real API:

```bash
# one-time: build the web pointed at the test API
VITE_API_URL=http://localhost:3014 npm run build --workspace=@brandforge/web
# (browsers are installed with: npx playwright install chromium)
npm run test:e2e
```

The delivery smoke test can also verify the deployed stack without starting
local servers:

```bash
E2E_REMOTE_BASE_URL=https://brandforge-tan.vercel.app \
E2E_API_URL=https://jpecina.duckdns.org/brandforge \
npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/deliverables.spec.ts
```

`tests/e2e/playwright.config.ts` starts both servers itself:
- API via the committed `tests/e2e/start-api.mjs` launcher → `:3014`,
  `brandforge_test` DB and disposable OS temporary directories.
- Web via `vite preview` on `:4173` serving `apps/web/dist`.

| Spec | Covers |
|---|---|
| `tests/e2e/demo.spec.ts` | "Try Demo — No registration required" → `/app`, demo banner, Café Aroma project and safe unavailable-agent fallback |
| `tests/e2e/auth.spec.ts` | register → "Check your email" → verify via maildir token → login → New Campaign modal creates a project → logout → login again |
| `tests/e2e/projects.spec.ts` | (demo session cookie) create project → favorite → create campaign → edit brand kit name → upload avatar PNG → delete project |
| `tests/e2e/agent-chat.spec.ts` | Agentic chat UI: routed run creation and scriptable SSE events covering steps, tools, usage, approval, cancellation, polling fallback, restoration after reopen and run history |
| `tests/e2e/deliverables.spec.ts` | Verified landing preview → publish → public render → revoke, plus asset availability and browser download |

### Agent-chat E2E strategy

`agent-chat.spec.ts` isolates the realtime UI contract. It routes
`POST /api/v1/conversations/{id}/messages` to a canned `{message, run}` shaped
like the `AgentRun` contract, and replaces `window.EventSource` (via
`page.addInitScript`) with a scriptable mock emitting the contract's SSE frames
(`{id, runId, seq, type, payload, createdAt}`). Everything else — demo auth
cookie, project creation, the GET conversation reload after `run.finished` —
goes through the real test API. The safe `AI_NOT_CONFIGURED` fallback stays
covered against the real backend in `demo.spec.ts`.

Note: the launcher runs `node dist/index.js` — rebuild the API (`npm run build
--workspace=@brandforge/api`) after any `apps/api/src` change, or the E2E run will test
stale code. (The vitest suites import `src/` directly and always test current code.)
