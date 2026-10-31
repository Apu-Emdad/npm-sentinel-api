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

This builds the API image and starts PostgreSQL, Redis, a one-off `migrate` job, the API and the worker. `migrate` applies the migrations and runs the seed, then exits; the API and the worker start after it succeeds. The worker uses the same image as the API but runs `node dist/worker.main`: it takes scan jobs from the Redis queue and has no HTTP server or port. The API listens on `PORT` from `.env`, with the Swagger docs at `/docs`. The logs stream in the terminal; press Ctrl+C to stop everything.

Inside Docker the API reaches PostgreSQL and Redis by service name (`postgres:5432`, `redis:6379`), so `docker-compose.yml` overrides `DATABASE_URL`, `REDIS_HOST` and `REDIS_PORT` from `.env` for the API, the worker and `migrate`.

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

Scans are run by a separate worker process. In a second terminal:

```bash
yarn start:worker
```

Or run the API and the worker together in one terminal with `yarn dev:all`. Without the worker, `POST /scans` still works but scans stay `queued`. In watch mode the worker compiles to `dist-worker/` (`tsconfig.worker.json`) so it doesn't clash with the API's `dist/`; `yarn build` still builds both into `dist/`.

`yarn migrate:deploy` (`prisma migrate deploy`) applies the migrations in `prisma/migrations`. After changing `prisma/schema.prisma`, create a migration with `yarn migrate:dev --create-only --name <name>`, review the SQL, then apply it with `yarn migrate:dev`. `yarn dev`, `yarn build` and `yarn test:e2e` generate the Prisma client into `src/generated/prisma` first; run `yarn prisma:generate` to do it on its own (Yarn doesn't run install scripts, so it isn't generated on `yarn install`).

`yarn db:seed` creates the `USER` and `SUPER_ADMIN` roles, then the first super admin: user name `admin`, email `admin@example.com`, password `12345678`. It does nothing if that user name or email already exists, so it is safe to run again. Change the password after the first login on any shared or hosted database.

`docker compose up -d --wait postgres redis` starts only PostgreSQL and Redis (Redis stores the active refresh tokens). Data is kept in named volumes, so it survives `docker compose down`; `docker compose down -v` deletes it.

The app validates `.env` on startup and exits with a list of the missing or invalid variables.

## Email (SMTP)

The API sends the verify email and reset password emails over SMTP with nodemailer, through [Brevo](https://www.brevo.com) (free plan), locally too. Set these in `.env`:

| Variable | What it is |
| --- | --- |
| `SMTP_HOST` | `smtp-relay.brevo.com` |
| `SMTP_PORT` | `587` (STARTTLS, default) or `465` (TLS) |
| `SMTP_USER` | The SMTP login from Brevo |
| `SMTP_PASS` | An SMTP key from Brevo. Keep it only in `.env`, never in `.env.example` |
| `MAIL_FROM` | `npm-sentinel <npmsentinel@gmail.com>`. Brevo only sends from a verified sender |
| `WEB_URL` | Base URL of the web app; the links in emails point there. Default `http://localhost:7001` |

In Brevo: verify the sender under **Senders, domains and IPs**, then generate an SMTP key under **SMTP and API → SMTP**. Brevo blocks SMTP from IP addresses it doesn't know; allow yours (or turn the blocking off) under **Security → Authorized IPs**.

The API starts without connecting to SMTP. If an email fails, the error is logged (never the SMTP password). Registration and forgot password still succeed; resend verification returns a 500 so the user can try again.

Rate limits: forgot password and resend verification allow 5 requests per 15 minutes per email and per IP, counted in Redis. The IP is `req.ip`; behind a proxy, enable Express `trust proxy` so it is the client's IP.

## Services

| Service | Host port | Container |
| --- | --- | --- |
| PostgreSQL 18 | `5433` | `npm-sentinel-postgres` |
| Redis 8 | `6381` | `npm-sentinel-redis` |
| API | `7000` (`PORT`) | `npm-sentinel-api` |
| Worker | none | `npm-sentinel-worker` |
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
