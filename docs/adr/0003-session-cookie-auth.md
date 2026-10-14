# ADR-0003: Session-cookie auth (not JWT)

**Status:** Accepted (2026-10-14)
**Context:** Phases 1–2 need full auth: register, email verify, login, logout,
password reset, roles, plus a demo mode with strict expiry. We chose between
stateless JWTs and server-side sessions.

**Decision:** **Server-side sessions** with an opaque token in an HttpOnly cookie.

- Cookie: `bf_session=<opaque id>`; `HttpOnly; Secure; SameSite=Lax; Path=/`.
- `sessions` table holds `token_hash` (never the raw token), `user_id`,
  `expires_at`, IP/user-agent for the account page.
- Sliding TTL: `SESSION_TTL_DAYS` (default 30); each authenticated request
  refreshes expiry.
- Every request loads the session from Postgres (indexed lookup; cheap at our scale).

**Rationale:**

1. **Revocation is trivial.** Compromised session? Delete the row — done.
   JWTs need blocklists/rotation schemes to achieve the same.
2. **Logout-everywhere** (`POST /api/v1/auth/logout-all`) is one
   `DELETE FROM sessions WHERE user_id = …`.
3. **Demo TTL** (ADR-0005) is just a shorter `expires_at` + `demo_expires_at`
   cleanup — no special token claims to coordinate.
4. **No token payload in the browser.** Roles/permissions are always read
   server-side from the DB, so privilege changes take effect immediately.

**Alternatives considered:**

- *JWT (access + refresh):* stateless and fashionable, but revocation,
  logout-everywhere, and demo expiry all become harder; secret rotation is
  riskier. The scaling benefit (no session lookup) is irrelevant at our scale.

**Consequences:**

- (+) Instant revocation, logout-everywhere, per-session device list.
- (+) Works naturally with the demo isolation model.
- (−) One indexed DB read per authenticated request (negligible; cacheable later).
- (−) Slightly more storage (sessions table) — cleaned by expiry + cron.
- CSRF: `SameSite=Lax` + origin check on mutations (documented in `docs/SECURITY.md`).
