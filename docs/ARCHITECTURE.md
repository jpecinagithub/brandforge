# BrandForge AI — Architecture

> Phases 1–3 (foundation + full auth + agentic engine). Last updated 2026-10-14.
> Decisions live in `docs/adr/`; deployment in `docs/DEPLOY_ORACLE.md` / `docs/DEPLOY_VERCEL.md`.

## 1. System context (C4 L1)

BrandForge AI is an agentic SaaS for marketing/branding content (brand kits, campaign
concepts, social posts, landing pages). One human owner-operator (Jon Peciña Iturbe)
runs it for his own clients and demos; end users sign up on the web app.

```
                    ┌──────────────┐
                    │    Users     │  browsers (EN default + ES), PWA
                    └──────┬───────┘
                           │ HTTPS
              ┌────────────▼────────────┐
              │  Vercel — apps/web      │  presentation only, static SPA
              │  React + TS, PWA        │  never calls OpenRouter directly
              └────────────┬────────────┘
                           │ HTTPS  https://jpecina.duckdns.org/brandforge/api/*
              ┌────────────▼────────────────────────────────┐
              │  Oracle Cloud — Ubuntu 24.04 aarch64         │
              │  143.47.63.169 · nginx (mi-gps server block)│
              │                                             │
              │  ┌─────────┐  ┌──────────┐  ┌────────────┐   │
              │  │ Fastify │  │ Postgres │  │   Worker   │   │
              │  │ API     │─▶│   15     │◀─│ (job queue)│   │
              │  │ :3013   │  │ (Docker) │  │ (Phase 3+) │   │
              │  └────┬────┘  └──────────┘  └─────┬──────┘   │
              │       │                          │          │
              │       └───────── OpenRouter ──────┘          │
              │         (inference, API/worker only)         │
              └─────────────────────────────────────────────┘
```

Key invariants:

1. **The browser never talks to OpenRouter.** All inference goes through the API or
   the worker (Phase 3). API keys live only in server `.env` / Docker secrets.
2. **Backend port 3013 on 127.0.0.1 is reserved for BrandForge** on the Oracle host
   (nginx proxies `/brandforge/api/` → `127.0.0.1:3013`). Never bind 0.0.0.0 there.
3. **Vercel is presentation only.** The owner deploys it himself; the agent never
   touches Vercel (standing rule).
4. **All IP is original.** No copied designs, code, or assets (see ADR-0004).

## 2. Containers (C4 L2)

| Container | Tech | Repo path | Runs on | Notes |
|---|---|---|---|---|
| Web SPA | React 19 + TS + Vite, PWA | `apps/web/` | Vercel | Bilingual EN/ES (EN default); `@vercel/analytics` in code; footer “Developed by Jon Peciña Iturbe” |
| API | Fastify + Node 24 | `apps/api/` | Oracle Docker, 127.0.0.1:3013 | Session-cookie auth, RBAC, rate limits, maildir/SMTP |
| Worker | Node 24 job runner | `apps/worker/` | Oracle Docker | Claims `agent_runs` queue, executes the orchestrator (Phase 3) |
| Database | Postgres 15 + Drizzle ORM | `packages/database/` | Oracle Docker volume | SQL-transparent migrations; seed script + demo assets |
| Reverse proxy | nginx | Oracle `/etc/nginx/sites-enabled/mi-gps` | Oracle host | `/brandforge/api/` → API; see `infrastructure/nginx/` reference |

Shared code: `packages/shared` (types/constants), `packages/ui` (UI primitives),
`packages/agent-core` (Phase 3 agent orchestration — stub), `packages/integrations`
(external providers — stub).

## 3. Request flows

### 3.1 Auth cookie flow (login → authenticated request → logout)

```
Browser                          API (Fastify)                    Postgres
  │  POST /api/v1/auth/login         │                                │
  │  {email, password}               │                                │
  │ ───────────────────────────────▶│  verify Argon2id hash          │
  │                                  │ ─────────────────────────────▶│
  │                                  │◀──────── user row ────────────│
  │                                  │  create session row (id, hash, │
  │                                  │  expires_at = now + 30d)      │
  │◀─ 200 + Set-Cookie: bf_session=  │                                │
  │   <opaque id>; HttpOnly;         │                                │
  │   Secure; SameSite=Lax; Path=/   │                                │
  │                                  │                                │
  │  GET /api/v1/brands               │                                │
  │  Cookie: bf_session=<id>         │                                │
  │ ───────────────────────────────▶│  load session, check expiry,   │
  │                                  │  sliding refresh, load user    │
  │                                  │ ─────────────────────────────▶│
  │◀─ 200 {brands…}                  │◀─────── rows ──────────────────│
  │                                  │                                │
  │  POST /api/v1/auth/logout-all    │  delete ALL sessions for user  │
  │ ───────────────────────────────▶│ ─────────────────────────────▶│
  │◀─ 200 + Clear-Cookie             │                                │
```

Why server sessions instead of JWT: instant revocation, logout-everywhere, and a
short-lived demo TTL are trivial (see ADR-0003).

### 3.2 Demo isolation flow

```
Browser                          API
  │  POST /api/v1/auth/demo          │
  │ ───────────────────────────────▶│  create ephemeral user demo-<uuid>
  │                                  │  role=user, demo_expires_at = now + 24h
  │                                  │  create isolated workspace + seed the
  │                                  │  Café Aroma project (from packages/database/seed-*)
  │◀─ 200 + session cookie (24h TTL)  │
  │                                  │
  │  … user explores …               │  quota guard: max N brands / assets /
  │                                  │  generations per demo workspace
  │                                  │
  │  (cron)                          │  delete demo users + workspaces with
                                     │  demo_expires_at < now (hard delete)
```

Fixed local dev account `demo@brandforge.local / Demo2026!` exists **only** when seeded
locally; the seed refuses `NODE_ENV=production` (see ADR-0005). ⚠️ Local-only credentials.

### 3.3 Asset serving flow

```
Browser ──GET /brandforge/api/v1/assets/:id──▶ API: auth check → ownership check
                                                → stream file from STORAGE_PATH
                                                (never a direct static mount)
```

Uploads: multipart → virus-scan hook point (Phase 3) → stored under
`STORAGE_PATH/<workspace-id>/…`. Demo seed PNGs are copied from
`packages/database/seed-assets/*.png` into `STORAGE_PATH` by `npm run db:seed`
(see `packages/database/seed-assets/README.md`).

## 4. Data model (summary)

Core tables in `packages/database/` (Drizzle schema; migrations are plain SQL):

| Table | Purpose |
|---|---|
| `users` | id, email (unique, citext), password_hash (Argon2id), role, email_verified_at, created_at, deleted_at (soft) |
| `email_verifications` / `password_resets` | single-use tokens, hashed at rest, short expiry |
| `sessions` | id (opaque), user_id, token_hash, expires_at, ip, user_agent, created_at |
| `workspaces` | id, owner_id, name, demo_expires_at (nullable) |
| `brands` | workspace_id, name, tagline/description (EN+ES JSON), colors, fonts, tone |
| `campaigns` | brand_id, name, objective, concepts (JSON) |
| `assets` | workspace_id, kind (logo/hero/post/poster), storage_key, width/height, demo flag |
| `generations` | (Phase 3) workspace_id, prompt, model, status, cost tracking |
| `audit_log` | append-only: who did what, when (admin/RGPD support) |

Conventions: UUIDv7 PKs, `created_at/updated_at` everywhere, soft-delete for users,
hard-delete for expired demos, all user content scoped by `workspace_id`.

## 5. Security model

- **AuthN:** Argon2id passwords; server-side opaque sessions in HttpOnly
  `Secure; SameSite=Lax` cookies; sliding 30-day TTL; logout-everywhere supported.
- **AuthZ (RBAC matrix):**

| Capability | admin | user | demo |
|---|---|---|---|
| Manage own workspace/brands/campaigns/assets | ✓ | ✓ | ✓ (quota-capped, 24h) |
| Generate with AI (Phase 3) | ✓ | ✓ | ✗ (or tiny fixed quota) |
| View audit log | ✓ | own only | ✗ |
| Manage users / promote admins | ✓ | ✗ | ✗ |
| Export my data (RGPD) | ✓ | ✓ | n/a |
| Delete my account (`DELETE /users/me`) | ✓ | ✓ | auto-expire |

- **Rate limits** (per IP + per session; see `docs/SECURITY.md` for the table):
  login 10/min, register 5/h, demo-create 3/h, password-reset 3/h, AI generate (Phase 3) 20/h.
- **Mail:** maildir transport in dev/test (`.eml` files under `MAILDIR_PATH`), SMTP in
  production. No real emails in tests.
- **Secrets:** only via env/Docker secrets; never in git, logs, or the browser bundle.
- **RGPD:** `GET /users/me/export` and `DELETE /users/me` exist; admin hard-delete
  path documented in `docs/SECURITY.md`.

## 6. What is stubbed for later phases (file pointers)

| Phase | Capability | Stub location | Notes |
|---|---|---|---|
| 3 | AI generation (OpenRouter) | `packages/agent-core/`, `apps/worker/`, `packages/integrations/` | ✅ Implemented: orchestrator + 13 tools + model router + SSE; browser never calls OpenRouter; prompt-injection guardrails (see `docs/SECURITY.md` §6) |
| 3 | File scan on upload | `apps/api/` upload handler | hook point documented, ClamAV optional |
| 4 | Landing-page builder | `apps/web/` routes + `packages/database/seed-data/demo-cafe.json` → `landingExample` | `demo-cafe.json` already carries the static example structure |
| 5 | Billing / teams / SSO | `apps/api/` billing module (not started) | — |

## 7. Environments

| Env | Frontend | API | DB |
|---|---|---|---|
| Local | `vite dev` :5173 | `tsx`/node :3013 (or docker) | docker postgres :5432 |
| Oracle prod | Vercel → `https://jpecina.duckdns.org/brandforge/api` | docker, 127.0.0.1:3013, behind nginx | docker volume `pgdata` |

Compose file: `infrastructure/docker/docker-compose.yml`.
Nginx reference: `infrastructure/nginx/` (real config lives in
`/etc/nginx/sites-enabled/mi-gps` on Oracle — never in `proyectos`' default_server).
