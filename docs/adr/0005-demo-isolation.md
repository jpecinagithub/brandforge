# ADR-0005: Demo isolation (ephemeral demo users)

**Status:** Accepted (2026-10-14)
**Context:** The landing page offers a "try the demo" path. Anonymous or shared
demo accounts leak data between visitors and accumulate junk; we need demos that
are isolated, quota-capped, and self-cleaning.

**Decision:**

1. **Ephemeral demo users.** `POST /api/v1/auth/demo` creates a fresh user
   (`demo-<uuid>@demo.brandforge.local`), role `user`, in its own workspace.
2. **Isolated workspaces.** Every demo user gets exactly one workspace seeded
   with the Café Aroma demo project (brand kit, campaign, assets from
   `packages/database/seed-assets/` + `seed-data/demo-cafe.json`). Demo users
   can never see or touch another workspace.
3. **24h TTL.** `users.demo_expires_at = now + 24h`; the session issued is also
   capped at 24h regardless of `SESSION_TTL_DAYS`. A cron job hard-deletes
   expired demo users, their workspaces, and their storage keys.
4. **Strict quotas.** Per demo workspace: max 1 brand, 1 campaign, 10 assets,
   and (Phase 3) a tiny fixed AI-generation quota. Exceeding returns 429 with a
   "create an account" nudge.
5. **Fixed local dev account, clearly marked.** The seed creates
   `demo@brandforge.local / Demo2026!` **only** when `NODE_ENV != production`.
   The seed **refuses** to create it in production unless an explicit
   `ALLOW_DEMO_SEED=true` override is set — and that override is never set in
   the production `.env` (see `.env.example`).

**Rationale:** per-visitor isolation removes cross-demo data leaks; TTL +
quotas bound abuse and storage growth; the local-only fixed account keeps the
dev loop fast without ever becoming a production backdoor.

**Consequences:**

- (+) Safe public demo with no manual cleanup.
- (+) Demo content doubles as the seed for local development.
- (−) The cleanup cron must actually run — it's part of the deploy checklist
  (`docs/DEPLOY_ORACLE.md` references it; the job lives with the API).
- ⚠️ `demo@brandforge.local / Demo2026!` are **LOCAL-ONLY** credentials. They are
  documented in the README quickstart for that reason and must never be created
  in production.
