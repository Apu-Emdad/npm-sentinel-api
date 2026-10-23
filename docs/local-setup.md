# Local Setup

## Requirements

- Node 24 (`nvm use` reads `.nvmrc`)
- Corepack enabled (`corepack enable`), which provides Yarn 4
- Docker with Compose

## Run

```bash
nvm use
yarn install
cp .env.example .env
docker compose up -d --wait
yarn migrate:deploy
yarn dev
```

`yarn migrate:deploy` (`prisma migrate deploy`) applies the migrations in `prisma/migrations`. After changing `prisma/schema.prisma`, create a migration with `yarn migrate:dev --create-only --name <name>`, review the SQL, then apply it with `yarn migrate:dev`. `yarn dev`, `yarn build` and `yarn test:e2e` generate the Prisma client into `src/generated/prisma` first; run `yarn prisma:generate` to do it on its own (Yarn doesn't run install scripts, so it isn't generated on `yarn install`).

`docker compose up` starts PostgreSQL and Redis (Redis stores the active refresh tokens). Data is kept in named volumes, so it survives `docker compose down`; `docker compose down -v` deletes it.

The app validates `.env` on startup and exits with a list of the missing or invalid variables.

## Services

| Service | Host port | Container |
| --- | --- | --- |
| PostgreSQL 18 | `5433` | `npm-sentinel-postgres` |
| Redis 8 | `6380` | `npm-sentinel-redis` |

Host ports are set in `.env` (`POSTGRES_PORT`, `REDIS_PORT`). They avoid 5432 and 6379 so they don't clash with a locally installed PostgreSQL or Redis.

## Connect with DataGrip

New data source → PostgreSQL:

| Field | Value |
| --- | --- |
| Host | `localhost` |
| Port | `5433` (`POSTGRES_PORT`) |
| Database | `npm_sentinel` (`POSTGRES_DB`) |
| User | `sentinel` (`POSTGRES_USER`) |
| Password | `sentinel` (`POSTGRES_PASSWORD`) |

Or paste the URL: `jdbc:postgresql://localhost:5433/npm_sentinel`
