# syntax=docker/dockerfile:1
# BrandForge worker image — Phase 3 agent run executor (ADR-0006).
# Based on apps/api/Dockerfile; no HTTP port, runs the claim loop.
# ---------- build ----------
FROM node:24-slim AS build
WORKDIR /app
# build tools for argon2 native compile (database dep)
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
COPY packages/shared/package.json packages/shared/
COPY packages/database/package.json packages/database/
COPY packages/integrations/package.json packages/integrations/
COPY packages/agent-core/package.json packages/agent-core/
COPY packages/agent-server/package.json packages/agent-server/
COPY apps/worker/package.json apps/worker/
RUN npm ci
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY packages/database/tsconfig.json packages/database/
COPY packages/database/src packages/database/src
COPY packages/database/drizzle.config.ts packages/database/
COPY packages/integrations packages/integrations
COPY packages/agent-core packages/agent-core
COPY packages/agent-server packages/agent-server
COPY apps/worker apps/worker
RUN npm run build --workspace=@brandforge/shared \
  && npm run build --workspace=@brandforge/database \
  && npm run build --workspace=@brandforge/integrations \
  && npm run build --workspace=@brandforge/agent-core \
  && npm run build --workspace=@brandforge/agent-server \
  && npm run build --workspace=@brandforge/worker \
  && npm prune --omit=dev --workspace=@brandforge/worker

# ---------- runtime ----------
FROM node:24-slim AS runtime
WORKDIR /app
RUN groupadd -r app && useradd -r -g app app \
  && mkdir -p /app/storage \
  && chown -R app:app /app
COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/packages/shared/dist ./packages/shared/dist
COPY --from=build --chown=app:app /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build --chown=app:app /app/packages/database/dist ./packages/database/dist
COPY --from=build --chown=app:app /app/packages/database/package.json ./packages/database/package.json
COPY --from=build --chown=app:app /app/packages/integrations/dist ./packages/integrations/dist
COPY --from=build --chown=app:app /app/packages/integrations/package.json ./packages/integrations/package.json
COPY --from=build --chown=app:app /app/packages/agent-core/dist ./packages/agent-core/dist
COPY --from=build --chown=app:app /app/packages/agent-core/package.json ./packages/agent-core/package.json
COPY --from=build --chown=app:app /app/packages/agent-server/dist ./packages/agent-server/dist
COPY --from=build --chown=app:app /app/packages/agent-server/package.json ./packages/agent-server/package.json
COPY --from=build --chown=app:app /app/apps/worker/dist ./apps/worker/dist
COPY --from=build --chown=app:app /app/apps/worker/package.json ./apps/worker/package.json
USER app
ENV NODE_ENV=production
CMD ["node", "apps/worker/dist/index.js"]
