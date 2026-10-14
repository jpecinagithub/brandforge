# Security — BrandForge AI

> Phases 1–2. Threat model: small SaaS, owner-operated; protect user accounts,
> user content, and server secrets. Revisit before Phase 3 (AI generation).

## 1. Secret handling

- Secrets live **only** in `.env` / Docker secrets on the server. Never in git,
  logs, error responses, or the browser bundle.
- `.env.example` documents every variable with placeholder values; the real
  `.env` is git-ignored and `0600` on Oracle.
- API keys (OpenRouter, Phase 3) are server-side only — the browser **never**
  sees them and never calls OpenRouter directly.
- If a secret leaks (chat, log, repo): rotate it immediately, then check
  `audit_log` for misuse. The owner pastes secrets himself; the agent only ever
  references them by variable name.
- Demo credentials `demo@brandforge.local / Demo2026!` are **LOCAL-ONLY**
  (see `docs/adr/0005-demo-isolation.md`); the production seed refuses to
  create them.

## 2. Password policy

- Minimum 12 characters. No composition rules beyond length (NIST-style).
- Hashed with **Argon2id** (memory-hard; OWASP parameters).
- Breach check on registration/password change: reject passwords found in
  known-breach lists (k-anonymity API or local list — implementation detail
  in `apps/api`).
- Rate-limited login (see table below) + generic "invalid credentials" errors
  (no user enumeration).
- Password reset: single-use token, hashed at rest, 1h expiry, emailed link;
  token invalidated after use and after password change.

## 3. Rate limits

Enforced per IP **and** per session/user (whichever hits first). 429 responses
carry `Retry-After`.

| Endpoint | Limit | Window | Notes |
|---|---|---|---|
| `POST /api/v1/auth/register` | 5 | hour / IP | + email verification required |
| `POST /api/v1/auth/login` | 10 | minute / IP | generic errors, no enumeration |
| `POST /api/v1/auth/demo` | 3 | hour / IP | demo workspace creation |
| `POST /api/v1/auth/password-reset` | 3 | hour / email | silent success (no enumeration) |
| `POST /api/v1/auth/verify-email` resend | 3 | hour / email | |
| Mutating API (general) | 120 | minute / session | |
| `POST /api/v1/generate/*` (Phase 3) | 20 | hour / user | demo workspaces: fixed tiny quota |
| Asset upload | 20 | hour / workspace | + size cap, type allowlist |

## 4. Session & cookie hardening

- Opaque session id; only `token_hash` stored (ADR-0003).
- Cookie flags: `HttpOnly; Secure; SameSite=Lax; Path=/`.
- Sliding expiry (`SESSION_TTL_DAYS=30`); absolute cap recommended at Phase 3.
- `POST /api/v1/auth/logout-all` revokes every session for the user.
- CSRF: `SameSite=Lax` + `Origin`/`Referer` check on state-changing requests.

## 5. Data protection / RGPD

- **Export:** `GET /api/v1/users/me/export` returns the user's data as JSON.
- **Delete:** `DELETE /api/v1/users/me` soft-deletes the account and revokes all
  sessions; hard-delete (data + storage keys) runs after a 30-day grace period
  or immediately on admin action with audit entry.
- **Admin:** user management endpoints are `role=admin` only (RBAC matrix in
  `docs/ARCHITECTURE.md` §5).
- **Demos:** expired demo users are hard-deleted automatically (24h TTL,
  ADR-0005) — no RGPD request needed.
- **Mail:** verification/reset emails only; no marketing mail without consent.
- **Logs:** no passwords, tokens, or prompt content in logs; IPs retained per
  the documented retention in `apps/api`.

## 6. Prompt-injection defense (Phase 3 placeholder)

When AI generation ships (OpenRouter via `apps/worker` + `packages/agent-core`),
the following are **required before launch** — not optional hardening:

1. **System/user separation:** untrusted content (brand docs, web snippets,
   uploads) is never concatenated into system instructions; it travels in a
   clearly-delimited `data` channel the model is instructed to treat as data.
2. **Output validation:** generated copy/assets are validated against a schema
   (lengths, allowed HTML subset, no scripts) before storage or display.
3. **Least privilege:** the generation worker has no credentials beyond the
   OpenRouter key and its own DB role; it cannot read other workspaces.
4. **Cost guards:** per-workspace generation quotas + per-request token caps;
   alerts on spikes.
5. **Audit:** every generation logs prompt hash, model, tokens, and cost to
   `generations` (no raw user PII in prompts beyond what's needed).

## 7. Uploads & assets

- Allowlist of MIME types (`image/png`, `image/jpeg`, `image/webp`, …); size cap
  (nginx `client_max_body_size 30m`; app-level cap lower per endpoint).
- Files stored under `STORAGE_PATH/<workspace-id>/…`; served only through the
  API after auth + ownership check — never a direct static mount.
- Virus-scan hook point on upload (Phase 3; ClamAV optional on Oracle).

## 8. Dependency & container hygiene

- `npm audit` in CI for every workspace; fix high/critical before release.
- Docker images: prefer official `-slim` bases; on **aarch64**, any image that
  `npm install`s a **native module** must install `python3 make g++` in the
  Dockerfile (prebuilt binaries often don't exist for linux/arm64).
- Rebuild images on base-image security updates; no `:latest` in production
  compose (pin digests or minor versions).

## 9. Incident checklist (owner)

1. Rotate the affected secret / revoke sessions (`logout-all` or DB delete).
2. Check `audit_log` + container logs for misuse window.
3. Fix the root cause; redeploy via `docs/DEPLOY_ORACLE.md`.
4. If user data was exposed: notify affected users (RGPD 72h rule) and record
   the incident.
