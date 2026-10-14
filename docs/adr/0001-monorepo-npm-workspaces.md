# ADR-0001: npm workspaces monorepo

**Status:** Accepted (2026-10-14)
**Context:** BrandForge AI has several deployables (web SPA, API, worker) plus
shared code (types, DB layer, UI primitives, agent core, integrations). We needed
one repo layout that keeps them versioned together without heavy tooling.

**Decision:** npm workspaces monorepo (`apps/*`, `packages/*`), no Turborepo/Nx/Lerna.

- Root `package.json` defines `workspaces` and the shared scripts
  (`build`, `test`, `typecheck`, `db:migrate`, `db:seed`) which fan out with
  `npm run <script> --workspaces --if-present`.
- Shared TypeScript config via `tsconfig.base.json`.
- One lockfile, one Node version (`.nvmrc`, engines `>=20`).

**Alternatives considered:**

- *Turborepo / Nx:* remote caching and task graphs we don't need yet; extra
  daemon/config surface for a 3-deployable project.
- *Polyrepo (one repo per app):* shared types/DB schema would drift or need a
  private npm registry — overkill at this stage.

**Consequences:**

- (+) Atomic cross-cutting changes (API + web + schema in one commit).
- (+) Zero extra build orchestration to install/maintain.
- (−) No build caching; full `npm run build` rebuilds everything (acceptable now).
- Migration path: if builds get slow, add Turborepo later without moving code.
