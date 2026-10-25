# syntax=docker/dockerfile:1

# Node 24 with Corepack, which provides the Yarn 4 version pinned in package.json
FROM node:24-slim AS base
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app

# Build stage: installs every dependency, generates the Prisma client and compiles to dist/.
# docker-compose.yml also uses this stage to run migrations and the seed, since those need
# the Prisma CLI and tsx (dev dependencies).
FROM base AS build
# Prisma's schema engine (used by migrate deploy) needs OpenSSL
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY package.json yarn.lock .yarnrc.yml ./
RUN --mount=type=cache,target=/root/.yarn/berry/cache yarn install --immutable
COPY . .
RUN yarn build

# Production dependencies only, for a smaller runtime image
FROM base AS prod-deps
COPY package.json yarn.lock .yarnrc.yml ./
RUN --mount=type=cache,target=/root/.yarn/berry/cache yarn workspaces focus --production

# Runtime stage: compiled app and production dependencies, run as the non-root node user
FROM node:24-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --chown=node:node package.json ./
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
