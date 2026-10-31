# npm-sentinel API

[![CI](https://github.com/Apu-Emdad/npm-sentinel-api/actions/workflows/ci.yml/badge.svg)](https://github.com/Apu-Emdad/npm-sentinel-api/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Scan an npm package before you install it. npm-sentinel runs static analysis on a package and returns a risk score from 0 to 100, a risk level, and a list of findings, each with the evidence that triggered it.

> **Status:** work in progress. Auth and user management are done; the scanner is being built. See [MVP scope](docs/mvp-scope.md) for the plan.

## Why

Installing a package runs code from a stranger on your machine. Typosquatted names, hidden `postinstall` scripts and obfuscated code are common ways malware gets into projects. npm-sentinel checks for these signs and explains what it found, so you can decide before you run `npm install`.

**Package code is never executed.** The analyzer only reads files and registry metadata. Tarballs are extracted in a throwaway container with no network access and deleted when the scan ends.

## Features

**Done**

- Register and log in with username or email
- Optional email verification and password reset by email (SMTP through Brevo)
- JWT access tokens with rotating refresh tokens in an `httpOnly` cookie; a reused refresh token revokes all of the user's sessions
- `USER` and `SUPER_ADMIN` roles, with user management for admins
- OpenAPI docs served by the API
- One-command setup with Docker Compose

**Planned (MVP)**

- Asynchronous scans processed by a background worker
- Five checks: install scripts, typosquatting, obfuscation, maintainer and publish anomalies, suspicious dependencies
- One risk score and level per scan, with the evidence for every finding
- Per-IP rate limiting on scans

## Tech stack

| Area                    | Tools                                            |
| ----------------------- | ------------------------------------------------ |
| Runtime                 | Node.js 24, TypeScript                           |
| Framework               | NestJS 12                                        |
| Database                | PostgreSQL 18, Prisma 7                          |
| Cache, tokens and queue | Redis 8, BullMQ                                  |
| Auth                    | JWT, Argon2 password hashing                     |
| Testing                 | Vitest, Supertest                                |
| Tooling                 | Yarn 4, oxlint, Prettier, GitHub Actions, Docker |

## Quick start

You only need [Docker](https://docs.docker.com/get-docker/).

```bash
git clone https://github.com/Apu-Emdad/npm-sentinel-api.git
cd npm-sentinel-api
cp .env.example .env
docker compose up --build
```

This starts PostgreSQL, Redis, the API and the scan worker, applies the database migrations and creates the first super admin: user name `admin`, password `12345678`. Press Ctrl+C to stop everything.

|                    | URL                            |
| ------------------ | ------------------------------ |
| API                | `http://localhost:7000`        |
| API docs (Swagger) | `http://localhost:7000/docs`   |
| Health check       | `http://localhost:7000/health` |

The port comes from `PORT` in `.env`. Change the secrets in `.env` and the super admin password before using it anywhere other than your own machine.

## Development

To run the API on your machine with hot reload, you need Node.js 24 and Corepack for Yarn 4. The full guide is in [docs/local-setup.md](docs/local-setup.md).

```bash
nvm use
yarn install
cp .env.example .env
docker compose up -d --wait postgres redis
yarn migrate:deploy
yarn db:seed
yarn dev:all
```

`yarn dev:all` runs the API and the scan worker together in one terminal. To run them separately, use `yarn dev` and `yarn start:worker` in two terminals.

### Scripts

| Command               | What it does                                           |
| --------------------- | ------------------------------------------------------ |
| `yarn dev`            | Start the API in watch mode                            |
| `yarn dev:all`        | Start the API and the scan worker in watch mode        |
| `yarn start:worker`   | Start the scan worker in watch mode                    |
| `yarn build`          | Generate the Prisma client and compile to `dist/`      |
| `yarn lint`           | Run oxlint                                             |
| `yarn typecheck`      | Type-check the whole project                           |
| `yarn test`           | Run unit tests                                         |
| `yarn test:e2e`       | Run end-to-end tests                                   |
| `yarn test:cov`       | Run unit tests with coverage                           |
| `yarn migrate:dev`    | Create and apply a migration after changing the schema |
| `yarn migrate:deploy` | Apply pending migrations                               |
| `yarn db:seed`        | Create the first super admin                           |
| `yarn docker:deps`    | Start PostgreSQL and Redis, apply migrations and seed  |

## Documentation

- [MVP scope](docs/mvp-scope.md): goal, user flow, checks, scoring and the API contract
- [Database schema](docs/schema.md): tables and design decisions
- [Local setup](docs/local-setup.md): running the project, services and ports

## Related

- [npm-sentinel-web](https://github.com/Apu-Emdad/npm-sentinel-web): the React dashboard

## License

[MIT](LICENSE) © Emdadul Haque Apu
