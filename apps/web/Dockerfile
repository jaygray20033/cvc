# syntax=docker/dockerfile:1.7
ARG NODE_VERSION=22.12.0

FROM node:${NODE_VERSION}-alpine AS base
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# Update corepack: the version bundled in this Node image has stale npm signing keys.
RUN npm install -g corepack@latest && corepack enable
WORKDIR /work

# ---------- deps ----------
FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir /pnpm/store

# ---------- dev: Vite HMR, source bind-mounted at runtime ----------
FROM deps AS dev
ENV NODE_ENV=development
EXPOSE 5173
CMD ["pnpm", "--filter", "web", "dev", "--", "--host"]

# ---------- build: static assets ----------
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN pnpm --filter @cvc/shared build && pnpm --filter web build

# ---------- prod: nginx static serving + runtime config.js ----------
FROM nginx:1.27-alpine AS prod
COPY infra/nginx/web.conf /etc/nginx/conf.d/default.conf
COPY --from=build /work/apps/web/dist /usr/share/nginx/html
COPY infra/web/docker-entrypoint.sh /docker-entrypoint.d/99-cvc-config.sh
RUN chmod +x /docker-entrypoint.d/99-cvc-config.sh
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null 2>&1 || exit 1