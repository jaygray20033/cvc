# syntax=docker/dockerfile:1.7
# Pin the Node version (P1.11). Same image runs staging + production; only env differs.
ARG NODE_VERSION=22.12.0

FROM node:${NODE_VERSION}-alpine AS base
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# OpenSSL is required by the Prisma engines on alpine.
# Update corepack: the version bundled in this Node image has stale npm signing keys.
RUN apk add --no-cache openssl && npm install -g corepack@latest && corepack enable
WORKDIR /work

# ---------- deps: install all workspace deps (layer-cached) ----------
FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir /pnpm/store

# ---------- build: compile shared + api, generate Prisma, deploy prod bundle ----------
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @cvc/shared build \
 && pnpm --filter api prisma:generate \
 && pnpm --filter api build
# Self-contained prod bundle (api + shared, prod deps only), then regenerate Prisma inside it.
# --legacy: pnpm v10 deploy otherwise requires inject-workspace-packages (breaks dev symlinks).
RUN pnpm --filter api deploy --prod --legacy /prod/api \
 && cd /prod/api && ./node_modules/.bin/prisma generate

# ---------- dev: hot reload, source bind-mounted at runtime ----------
FROM deps AS dev
ENV NODE_ENV=development
# git is needed by the husky/lint-staged hooks that run in this container.
RUN apk add --no-cache git && git config --global --add safe.directory /work
EXPOSE 3000
CMD ["pnpm", "--filter", "api", "start:dev"]

# ---------- prod: runtime only, non-root ----------
FROM node:${NODE_VERSION}-alpine AS prod
ENV NODE_ENV=production
WORKDIR /app
# openssl for Prisma engines; run as a non-root user.
RUN apk add --no-cache openssl \
 && addgroup -S nodejs && adduser -S nestjs -G nodejs
COPY --from=build /prod/api ./
USER nestjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]