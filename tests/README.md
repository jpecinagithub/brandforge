# BrandForge tests (Phases 1–2)

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
| `packages/integrations/src/openrouter-stub.test.ts` | Phase-3 stub: `chat()` throws `NotImplementedError`, never calls the network |

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
| `apps/api/src/routes/projects.integration.test.ts` | project → campaign → brand kit → **chat stub** (`notice === 'AI_NOT_CONFIGURED'`, both messages persisted, **zero external HTTP calls**); favorite toggle; asset upload; delete; non-member 404 |
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

`tests/mocks/openrouter.mock.ts` is a **TEST DOUBLE — Phase 3 stub, never billed**: a fake
`OpenRouterClient` returning a canned echo reply. Phase 1–2 code never calls any AI provider;
`packages/integrations` only contains the stub that throws `NotImplementedError`, and the
integration suite additionally replaces global `fetch` with a throwing recorder
(`tests/setup/no-network.ts`) — any external HTTP attempt fails the run loudly.

## 3. E2E — `npm run test:e2e` (Playwright, Chromium headless)

Drives the real UI against the real API:

```bash
# one-time: build the web pointed at the test API
VITE_API_URL=http://localhost:3014 npm run build --workspace=@brandforge/web
# (browsers are installed with: npx playwright install chromium)
npm run test:e2e
```

`tests/e2e/playwright.config.ts` starts both servers itself:
- API via `/tmp/bf-run-api-test.sh` → `:3014`, `brandforge_test` DB, `/tmp/bf-test-*` dirs
  (recreate that script if `/tmp` was wiped — see below).
- Web via `vite preview` on `:4173` serving `apps/web/dist`.

| Spec | Covers |
|---|---|
| `tests/e2e/demo.spec.ts` | "Try Demo — No registration required" → `/app`, demo banner, Café Aroma project, open workspace, chat shows the AI_NOT_CONFIGURED notice; sending a message gets the honest stub reply |
| `tests/e2e/auth.spec.ts` | register → "Check your email" → verify via maildir token → login → New Campaign modal creates a project → logout → login again |
| `tests/e2e/projects.spec.ts` | (demo session cookie) create project → favorite → create campaign → edit brand kit name → upload avatar PNG → delete project |

### If `/tmp` was wiped (VM restart)

`/tmp/bf-run-api-test.sh`, `/tmp/bf-test-maildir` and `/tmp/bf-test-storage` are ephemeral.
Recreate the launcher (it is intentionally NOT committed):

```bash
cat > /tmp/bf-run-api-test.sh <<'EOF'
#!/bin/bash
export DATABASE_URL=postgres://brandforge:brandforge_dev_pw@localhost:5432/brandforge_test
export PORT=3014
export NODE_ENV=development
export CORS_ORIGIN="http://localhost:5173,http://localhost:4173"
export MAIL_TRANSPORT=maildir
export MAIL_FROM="noreply@brandforge.local"
export MAILDIR_PATH="/tmp/bf-test-maildir"
export STORAGE_PATH="/tmp/bf-test-storage"
cd "$HOME/workspace/brandforge/apps/api"
exec node dist/index.js
EOF
chmod +x /tmp/bf-run-api-test.sh
```

Note: the launcher runs `node dist/index.js` — rebuild the API (`npm run build
--workspace=@brandforge/api`) after any `apps/api/src` change, or the E2E run will test
stale code. (The vitest suites import `src/` directly and always test current code.)
