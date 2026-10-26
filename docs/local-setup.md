# Local Setup

## Requirements

- Node 24 (`nvm use` reads `.nvmrc`)
- Corepack enabled (`corepack enable`), which provides Yarn 4
- Docker with Compose

## Run with Docker

Only Docker is needed:

```bash
cp .env.example .env
docker compose up --build
```

This builds the API image and starts PostgreSQL, Redis, a one-off `migrate` job and the API. `migrate` applies the migrations and runs the seed, then exits; the API starts after it succeeds. The API listens on `PORT` from `.env`, with the Swagger docs at `/docs`. The logs stream in the terminal; press Ctrl+C to stop everything.

Inside Docker the API reaches PostgreSQL and Redis by service name (`postgres:5432`, `redis:6379`), so `docker-compose.yml` overrides `DATABASE_URL`, `REDIS_HOST` and `REDIS_PORT` from `.env` for the API and `migrate`.

## Run for development

```bash
nvm use
yarn install
cp .env.example .env
docker compose up -d --wait postgres redis
yarn migrate:deploy
yarn db:seed
yarn dev
```

`yarn migrate:deploy` (`prisma migrate deploy`) applies the migrations in `prisma/migrations`. After changing `prisma/schema.prisma`, create a migration with `yarn migrate:dev --create-only --name <name>`, review the SQL, then apply it with `yarn migrate:dev`. `yarn dev`, `yarn build` and `yarn test:e2e` generate the Prisma client into `src/generated/prisma` first; run `yarn prisma:generate` to do it on its own (Yarn doesn't run install scripts, so it isn't generated on `yarn install`).

`yarn db:seed` creates the `USER` and `SUPER_ADMIN` roles, then the first super admin: user name `admin`, email `admin@example.com`, password `12345678`. It does nothing if that user name or email already exists, so it is safe to run again. Change the password after the first login on any shared or hosted database.

`docker compose up -d --wait postgres redis` starts only PostgreSQL and Redis (Redis stores the active refresh tokens). Data is kept in named volumes, so it survives `docker compose down`; `docker compose down -v` deletes it.

The app validates `.env` on startup and exits with a list of the missing or invalid variables.

## Services

| Service | Host port | Container |
| --- | --- | --- |
| PostgreSQL 18 | `5433` | `npm-sentinel-postgres` |
| Redis 8 | `6381` | `npm-sentinel-redis` |
| API | `6000` (`PORT`) | `npm-sentinel-api` |
| Migrations and seed (one-off) | none | `npm-sentinel-migrate` |

Host ports are set in `.env` (`POSTGRES_PORT`, `REDIS_PORT`). They avoid 5432 and 6379 so they don't clash with a locally installed PostgreSQL or Redis.

`REDIS_DB` is the Redis database number (0 to 15). Two apps can share one Redis server if they use different numbers, so their keys don't mix.

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
