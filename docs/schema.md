# Database Schema

PostgreSQL, managed with Prisma. This document is the design; `prisma/schema.prisma` (issue #5) implements it.

## Conventions

- Table and column names are `snake_case`; tables are plural. Prisma models are `PascalCase` singular and map to them with `@@map` / `@map`.
- Every table has two ids: `id bigserial` (auto-increment primary key from Prisma's `autoincrement()`, used by foreign keys and joins) and `uid text default generate_uid()` (a unique 10-character random id from `0-9a-zA-Z`, the only id exposed by the API). `generate_uid()` is a Postgres function created in the `init` migration.
- Timestamps are `timestamp(3)` (no time zone). Prisma always stores them in UTC.
- Fixed value sets are Postgres enums, named in `PascalCase` like their Prisma enums (no `@@map` on enums). Values that grow over time (review sources) are `text`.
- No soft deletes.

## ER diagram

```mermaid
erDiagram
    roles ||--o{ users : "assigned to"
    users ||--o{ email_tokens : "has"
    users |o--o{ scans : "starts"
    users |o--o{ reviews : "writes"
    packages ||--o{ package_versions : "has"
    package_versions ||--o{ scans : "scanned by"
    package_versions ||--o{ reviews : "reviewed in"
    scans ||--o{ findings : "produces"
    users |o--o{ manifests : "starts"
    manifests ||--o{ manifest_dependencies : "groups"
    scans ||--o{ manifest_dependencies : "listed in"

    roles {
        bigint id PK
        text uid UK
        text name UK
    }
    users {
        bigint id PK
        text uid UK
        text user_name UK
        text email UK
        text password_hash
        bigint role_id FK
        timestamp email_verified_at
    }
    email_tokens {
        bigint id PK
        text uid UK
        bigint user_id FK
        EmailTokenType type
        text token_hash UK
    }
    packages {
        bigint id PK
        text uid UK
        text name UK
    }
    package_versions {
        bigint id PK
        text uid UK
        bigint package_id FK
        text version
        timestamp published_at
    }
    scans {
        bigint id PK
        text uid UK
        bigint user_id FK "null if anonymous"
        bigint package_version_id FK "one scan per version"
        text package_name
        ScanStatus status
        smallint risk_score
        RiskLevel risk_level
    }
    findings {
        bigint id PK
        text uid UK
        bigint scan_id FK
        CheckType check_type
        Severity severity
    }
    reviews {
        bigint id PK
        text uid UK
        bigint package_version_id FK
        ReviewVerdict verdict
        text source
    }
    manifests {
        bigint id PK
        text uid UK
        bigint user_id FK "null if anonymous"
        text name
        boolean include_dev
        jsonb skipped
    }
    manifest_dependencies {
        bigint id PK
        text uid UK
        bigint manifest_id FK
        bigint scan_id FK
        text package_name
        text range
        boolean is_dev
    }
```

## Enums

| Enum | Values |
| --- | --- |
| `ScanStatus` | `queued`, `running`, `completed`, `failed` |
| `ScanError` | `package_not_found`, `version_not_found`, `tarball_too_large`, `timeout`, `internal_error` |
| `RiskLevel` | `low`, `medium`, `high` |
| `Severity` | `low`, `medium`, `high` |
| `CheckType` | `install_scripts`, `typosquatting`, `obfuscation`, `maintainer_anomaly`, `suspicious_dependency` |
| `ReviewVerdict` | `malicious`, `benign` |
| `EmailTokenType` | `verify_email`, `reset_password` |

## Tables

### `roles`

One row per role. Created by the seed (`yarn db:seed`) with `USER` and `SUPER_ADMIN`; code refers to them through the `ROLE` constant (`src/common/constants/roles.ts`).

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | `bigint` | no | PK, auto-increment (`bigserial`) |
| `uid` | `text` | no | Unique, default `generate_uid()` (10 characters) |
| `name` | `text` | no | Unique, e.g. `USER`, `SUPER_ADMIN` |
| `role_permissions` | `jsonb` | yes | Not used yet; always empty (role permissions are out of scope) |
| `created_at` | `timestamp(3)` | no | Default `now()` |
| `updated_at` | `timestamp(3)` | no | Updated by Prisma |

### `users`

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | `bigint` | no | PK, auto-increment (`bigserial`) |
| `uid` | `text` | no | Unique, default `generate_uid()` (10 characters) |
| `user_name` | `text` | no | Unique, stored lowercase. 3 to 30 characters: `a-z`, `0-9`, `_`, `-` |
| `email` | `text` | no | Unique, stored lowercase |
| `password_hash` | `text` | no | bcrypt or argon2 hash |
| `role_id` | `bigint` | no | FK → `roles.id`, on delete restrict. New users get the `USER` role |
| `is_active` | `boolean` | no | Default `true` |
| `email_verified_at` | `timestamp(3)` | yes | When the email was verified. `null` until then. The seeded super admin starts verified |
| `created_at` | `timestamp(3)` | no | Default `now()` |
| `updated_at` | `timestamp(3)` | no | Updated by Prisma |

### `email_tokens`

One-use tokens sent in email links. The link carries 32 random bytes as hex; only their SHA-256 hash is stored.

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | `bigint` | no | PK, auto-increment (`bigserial`) |
| `uid` | `text` | no | Unique, default `generate_uid()` (10 characters). Never sent anywhere |
| `user_id` | `bigint` | no | FK → `users.id`, on delete cascade. Indexed with `type` |
| `type` | `EmailTokenType` | no | `verify_email` or `reset_password` |
| `token_hash` | `text` | no | Unique. SHA-256 of the token, as hex |
| `expires_at` | `timestamp(3)` | no | 24 hours after creation for `verify_email`, 30 minutes for `reset_password` |
| `used_at` | `timestamp(3)` | yes | Set when the link is used; a used token never works again |
| `created_at` | `timestamp(3)` | no | Default `now()` |

### `packages`

One row per npm package name Sentinel has resolved on the registry.

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | `bigint` | no | PK, auto-increment (`bigserial`) |
| `uid` | `text` | no | Unique, default `generate_uid()` (10 characters) |
| `name` | `text` | no | Unique, full name including scope (`@scope/name`) |
| `created_at` | `timestamp(3)` | no | Default `now()` |
| `updated_at` | `timestamp(3)` | no | Updated by Prisma |

### `package_versions`

One row per version Sentinel has resolved.

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | `bigint` | no | PK, auto-increment (`bigserial`) |
| `uid` | `text` | no | Unique, default `generate_uid()` (10 characters) |
| `package_id` | `bigint` | no | FK → `packages.id`, on delete cascade |
| `version` | `text` | no | Exact semver, e.g. `1.2.3` |
| `published_at` | `timestamp(3)` | yes | From registry `time[version]` |
| `tarball_url` | `text` | no | From `dist.tarball` |
| `integrity` | `text` | yes | From `dist.integrity` (sha512), to verify the download |
| `created_at` | `timestamp(3)` | no | Default `now()` |

Constraints: unique `(package_id, version)`.

### `scans`

The analyzer result of one package version. Each version has one scan; scanning it again reruns the checks on the same row, since only the latest result is kept.

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | `bigint` | no | PK, auto-increment (`bigserial`) |
| `uid` | `text` | no | Unique, default `generate_uid()` (10 characters). Returned by `POST /scans` as the scan id |
| `user_id` | `bigint` | yes | FK → `users.id`, on delete set null. The user who scanned it last; `null` if only anonymous visitors did |
| `package_name` | `text` | no | Package name from the registry |
| `package_version_id` | `bigint` | no | FK → `package_versions.id`, on delete cascade. Unique: one scan per version. `POST /scans` finds the version on the registry first, so a missing package or version never gets a scan |
| `status` | `ScanStatus` | no | `queued`, `running`, `completed`, `failed`. Default `queued` |
| `risk_score` | `smallint` | yes | 0 to 100, set when `completed`. Check constraint `risk_score between 0 and 100` |
| `risk_level` | `RiskLevel` | yes | `low`, `medium`, `high`. Set when `completed` |
| `error` | `ScanError` | yes | `package_not_found`, `version_not_found`, `tarball_too_large`, `timeout`, `internal_error`. Set when `failed` |
| `metadata_snapshot` | `jsonb` | yes | Registry facts the checks used: maintainers, publish times, downloads, dependencies |
| `analyzer_version` | `text` | yes | Version of the analyzer that produced the result |
| `created_at` | `timestamp(3)` | no | Default `now()` |
| `started_at` | `timestamp(3)` | yes | Set when `running` |
| `completed_at` | `timestamp(3)` | yes | Set when `completed` or `failed` |

Indexes:

- unique `(package_version_id)`: the scan of a version, for rescans and `GET /packages/:name`
- `(user_id, created_at desc)`: scan history (later)
- `(status)`: find stuck or queued scans

### `manifests`

One package.json sent to `POST /scans/bulk` (npm calls package.json the package manifest). Its dependencies are scanned together.

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | `bigint` | no | PK, auto-increment (`bigserial`) |
| `uid` | `text` | no | Unique, default `generate_uid()`. Returned by `POST /scans/bulk` |
| `user_id` | `bigint` | yes | FK → `users.id`, on delete set null. `null` if anonymous |
| `name` | `text` | yes | The `name` field of the package.json, shown on the results page. `null` if it has none |
| `include_dev` | `boolean` | no | Whether `devDependencies` were scanned too |
| `skipped` | `jsonb` | no | Default `[]`. Dependencies that were not scanned, as `{ packageName, range, isDev, reason }`: git, URL, local and workspace dependencies, missing packages, ranges no version matches |
| `created_at` | `timestamp(3)` | no | Default `now()` |

Indexes:

- `(user_id, created_at desc)`: manifest history (later)

### `manifest_dependencies`

One scanned dependency of a manifest. It points to the scan of the version the range resolved to, so manifests share scans with each other and with `POST /scans`. It holds no results.

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | `bigint` | no | PK, auto-increment (`bigserial`) |
| `uid` | `text` | no | Unique, default `generate_uid()` |
| `manifest_id` | `bigint` | no | FK → `manifests.id`, on delete cascade |
| `scan_id` | `bigint` | no | FK → `scans.id`, on delete cascade |
| `package_name` | `text` | no | The dependency name as written in package.json (the alias name for `npm:` aliases) |
| `range` | `text` | no | The version as written in package.json, e.g. `^4.21.1` or `npm:lodash@^4.17.0` |
| `is_dev` | `boolean` | no | Default `false`. `true` when it came from `devDependencies`; a name in both lists counts as a normal dependency |
| `created_at` | `timestamp(3)` | no | Default `now()` |

Indexes:

- unique `(manifest_id, package_name)`: one item per dependency
- `(scan_id)`: the manifests a scan is listed in

### `findings`

One red flag found by one check in one scan.

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | `bigint` | no | PK, auto-increment (`bigserial`) |
| `uid` | `text` | no | Unique, default `generate_uid()` (10 characters) |
| `scan_id` | `bigint` | no | FK → `scans.id`, on delete cascade |
| `check_type` | `CheckType` | no | `install_scripts`, `typosquatting`, `obfuscation`, `maintainer_anomaly`, `suspicious_dependency`. Which check produced the finding |
| `severity` | `Severity` | no | `low`, `medium`, `high` |
| `summary` | `text` | no | One-line explanation, generated by the check (not user input) |
| `evidence` | `text` | no | The exact script, string or name that triggered it |
| `details` | `jsonb` | yes | Check-specific data, e.g. file path, line, matched package, entropy value |
| `created_at` | `timestamp(3)` | no | Default `now()` |

Indexes: `(scan_id)`.

### `reviews`

Ground truth for research. A review says whether a package version is malicious or benign, and who said so.

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | `bigint` | no | PK, auto-increment (`bigserial`) |
| `uid` | `text` | no | Unique, default `generate_uid()` (10 characters) |
| `package_version_id` | `bigint` | no | FK → `package_versions.id`, on delete cascade |
| `verdict` | `ReviewVerdict` | no | `malicious`, `benign` |
| `source` | `text` | no | Where the review came from, e.g. `manual`, `github-advisory`, `osv` |
| `source_ref` | `text` | yes | Advisory id or URL |
| `notes` | `text` | yes | |
| `reviewed_by` | `bigint` | yes | FK → `users.id`, on delete set null. `null` for imported reviews |
| `created_at` | `timestamp(3)` | no | Default `now()` |

Constraints: unique `(package_version_id, source)`. Different sources may disagree, so each source gets its own row.

## Design decisions

- **Two ids per row.** The integer `id` keeps primary keys, foreign keys and indexes small and fast. The random `uid` is what the API exposes, so URLs like `/scans/:id` can't be guessed or counted. The integer `id` never leaves the backend.
- **Roles live in their own table.** Each user has exactly one role through `users.role_id`; many users share a role. New roles are added as rows, without a migration. A role in use can't be deleted (`on delete restrict`). Permissions are not modelled yet.
- **Scans are public, so `user_id` is optional.** Anonymous scans have no user. Deleting a user keeps their scans as anonymous, since scans are also research data. Rate limiting is per IP and lives in Redis; IP addresses are not stored in the database.
- **One scan per package version.** A published npm version's code never changes, so older results add nothing. `POST /scans` checks the registry first and creates the `packages` and `package_versions` rows only after it confirms them, so those tables never hold names that don't exist.
- **Manifests reuse scans.** A manifest does not copy results; each dependency points to the one scan of its version. A completed or running scan is reused as it is, and only a failed one is queued again. Ranges are resolved the way npm does: the `latest` tag when it fits, otherwise the highest version that fits.
- **Reviews are per version, not per package.** Malicious code is usually in specific versions, e.g. a hijacked release of a popular package. A typosquat gets one review per version.
- **`metadata_snapshot` keeps scans reproducible.** Downloads and maintainers change over time. The snapshot records what the checks saw, so a scan can be re-analyzed later for research.
- **`analyzer_version` separates results from different analyzer logic.** When checks or weights change, old and new scores stay comparable.
- **Email tokens are stored hashed.** Someone who reads the database still can't use a link, the same way passwords are stored as hashes. SHA-256 is enough here (no Argon2) because the token is 32 random bytes, so it can't be guessed. Creating a token deletes the user's older unused ones of that type, so only the newest link works. Used and expired rows stay until the next token of that type replaces them.
- **`check_type` is an enum.** Only known checks can be stored; adding a check means adding an enum value with a migration.

## How this becomes a dataset

Join `reviews` to the completed scan of the same version:

```sql
select pv.id, p.name, pv.version, r.verdict, s.risk_score, s.analyzer_version
from reviews r
join package_versions pv on pv.id = r.package_version_id
join packages p on p.id = pv.package_id
join scans s on s.package_version_id = pv.id and s.status = 'completed';
```

Each row is one reviewed example; its findings are the features.
