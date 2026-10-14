# @brandforge/api

BrandForge REST API — Fastify + TypeScript. Phases 1–2: foundation + auth.
Base path `/api/v1`, session cookie `bf_session`.

## Run

```bash
# from the repo root
npm install
cp .env.example .env            # edit values (never commit .env)

# database (needs Postgres; or: docker compose -f infrastructure/docker/docker-compose.yml up -d postgres)
npm run db:generate             # create Drizzle migrations (no DB needed)
npm run db:migrate              # apply migrations (needs DATABASE_URL)
npm run db:seed                 # dev seed: demo@brandforge.local / Demo2026! (LOCAL ONLY)

# api
npm run dev --workspace=@brandforge/api     # tsx watch, http://localhost:3013
npm run build --workspace=@brandforge/api  # tsc → dist/
npm start --workspace=@brandforge/api      # node dist/index.js
```

Swagger UI: `http://localhost:3013/docs` (only when `NODE_ENV != production`).

## Environment

See root `.env.example` for the full list. Key vars:

| Var | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | — (required) | Postgres connection string |
| `PORT` | `3013` | Listen port (reserved BrandForge port on Oracle) |
| `FRONTEND_URL` | `http://localhost:5173` | Used for CORS default + email links (`/verify-email?token=…`, `/reset-password?token=…`) |
| `CORS_ORIGIN` | `http://localhost:5173` | Comma-separated allowed browser origins |
| `MAIL_TRANSPORT` | `maildir` | `maildir` writes `.eml` to `MAILDIR_PATH` + logs; `smtp` uses `SMTP_*` |
| `STORAGE_PATH` | `./storage` | Local disk root for avatars/assets |
| `SESSION_TTL_DAYS` | `30` | Cookie + session lifetime |

## Auth model

- Passwords: argon2id (`argon2` package). Policy: ≥10 chars, 1 upper, 1 lower, 1 digit (shared Zod schema).
- Sessions: 32-byte base64url token in `bf_session` cookie (HttpOnly, `Path=/`, `SameSite=Lax`, `Secure` in production, 30d Max-Age); only the sha256 hex is stored.
- Email verification tokens (24h) and password reset tokens (1h): same token/hash scheme, single use.
- Demo accounts (`POST /api/v1/auth/demo`): ephemeral, `is_demo=true`, expire in 24h, isolated demo workspace seeded via the shared `seedDemoContent()` from `@brandforge/database`. Expired demos are removed by `npm run cleanup-demos` (future: daily worker cron).
- Authorization: every resource route checks `workspace_members`; non-members get **404, never 403**, to avoid leaking existence.

## Rate limits

Global: 300 req / 15 min per IP. Tighter per route: login 20/15min, register 10/hour, demo 10/hour, resend-verification 10/hour, forgot-password 5/hour.

## Chat (honest stub)

`POST /api/v1/conversations/:id/messages` saves the user message and a fixed
assistant reply: *"AI generation is not configured yet in this build (Phase 3)…"*
with `notice: 'AI_NOT_CONFIGURED'`. No model is called. Phase 3 wires the real
orchestrator (`@brandforge/agent-core`) + OpenRouter (`@brandforge/integrations`).

## Admin

`GET /api/v1/admin/overview`, `GET /api/v1/admin/users?search=&page=&limit=`,
`POST /api/v1/admin/users/:id/block|unblock`, `PATCH /api/v1/admin/users/:id/admin`,
`GET /api/v1/admin/audit-logs?limit=`. Requires `is_admin`
(`npm run promote-admin -- <email>`).

## Scripts

- `npm run promote-admin -- <email>` — set `is_admin=true`.
- `npm run cleanup-demos` — delete expired demo users + orphaned demo workspaces + their storage files.

## Layout

```
src/
  index.ts        — Fastify bootstrap (helmet/cors/rate-limit/cookie/multipart/swagger)
  config.ts       — env parsing
  db.ts           — DB singleton
  errors.ts       — {error:{code,message}} envelope helpers
  auth/           — password.ts (argon2), tokens.ts (randomToken/sha256)
  authz.ts        — authenticate/requireAdmin/requireWorkspaceRole, audit()
  email.ts        — nodemailer, maildir/smtp, verify/reset/welcome templates
  storage.ts      — StorageAdapter + LocalDiskStorage (S3-ready interface)
  routes/         — health, auth, users, workspaces, projects, campaigns,
                    brandkits, conversations (stub), assets, admin
  scripts/        — promote-admin, cleanup-demos
```
