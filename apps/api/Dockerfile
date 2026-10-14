# syntax=docker/dockerfile:1
# ---------- build ----------
FROM node:24-slim AS build
WORKDIR /app
# build tools for argon2 native compile
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
COPY packages/shared/package.json packages/shared/
COPY packages/database/package.json packages/database/
COPY packages/integrations/package.json packages/integrations/
COPY packages/agent-core/package.json packages/agent-core/
COPY packages/agent-server/package.json packages/agent-server/
COPY apps/api/package.json apps/api/
RUN npm ci
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY packages/database/src packages/database/src
COPY packages/database/drizzle.config.ts packages/database/
COPY packages/integrations/src packages/integrations/src
COPY packages/agent-core/src packages/agent-core/src
COPY packages/agent-server/src packages/agent-server/src
COPY apps/api apps/api
RUN npm run build --workspace=@brandforge/shared \
  && npm run build --workspace=@brandforge/database \
  && npm run build --workspace=@brandforge/integrations \
  && npm run build --workspace=@brandforge/agent-core \
  && npm run build --workspace=@brandforge/agent-server \
  && npm run build --workspace=@brandforge/api \
  && npm prune --omit=dev --workspace=@brandforge/api

# ---------- runtime ----------
FROM node:24-slim AS runtime
WORKDIR /app
RUN groupadd -r app && useradd -r -g app app \
  && mkdir -p /app/storage /app/maildir \
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
COPY --from=build --chown=app:app /app/apps/api/dist ./apps/api/dist
COPY --from=build --chown=app:app /app/apps/api/package.json ./apps/api/package.json
USER app
ENV NODE_ENV=production
EXPOSE 3013
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3013)+'/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "apps/api/dist/index.js"]
