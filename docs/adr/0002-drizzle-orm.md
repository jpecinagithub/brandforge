# ADR-0002: Drizzle ORM (not Prisma)

**Status:** Accepted (2026-10-14)
**Context:** The API and worker need a Postgres data layer that runs on the
Oracle Cloud **aarch64** host and in restricted networks, with code-reviewed,
auditable migrations.

**Decision:** Use **Drizzle ORM** (`packages/database/`) instead of Prisma.

**Rationale:**

1. **No binary engine downloads.** Prisma ships query-engine binaries that must
   match the target platform; on ARM64 hosts and restricted networks those
   downloads are a recurring source of breakage. Drizzle is pure TypeScript over
   `node-postgres` — `npm install` just works on aarch64.
2. **SQL-transparent migrations.** Drizzle generates plain SQL migration files
   that a human reviews and that `psql` can apply directly. No hidden migration
   engine state — important when the owner runs `db:migrate` guided-hands on
   Oracle.
3. **Lightweight.** No extra client-generation step in CI/build; the Docker
   image stays small (matters on ARM builds, which are already slow).
4. **pg-boss later.** When the worker needs a real Postgres-backed queue
   (Phase 3), pg-boss plugs straight into the same `pg` pool — no second
   client.

**Alternatives considered:**

- *Prisma:* nicer DX for some, but the engine-binary problem on ARM64 Oracle is
  a hard operational risk, and its migration model is more opaque.
- *Raw SQL + pg only:* maximum transparency, but we lose type-safe queries and
  schema co-location; Drizzle keeps 90% of the transparency with far less
  boilerplate.
- *Kysely:* a fine second choice; Drizzle won on migration tooling maturity.

**Consequences:**

- (+) Reliable installs on ARM64 and offline-ish networks.
- (+) Migrations are reviewable SQL in git.
- (−) Smaller ecosystem than Prisma (fewer community plugins); acceptable —
  we need queries, migrations, and seeds, not a plugin marketplace.
- Schema, migrations, and the seed script all live in `packages/database/`.
