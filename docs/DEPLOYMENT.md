# Deployment and Operations Guide

This document covers deployment prerequisites, required environment variables, security configuration, and operational guidance for the Todoist Companion app.

---

## 1. Required Environment Variables

All variables marked **required** must be set before the app will start or handle requests correctly.

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | **required** | Postgres connection string. Must point to a test/dev database for `pnpm db:migrate` and `pnpm db:seed`. |
| `SESSION_SECRET` | **required** | AES-256-GCM key used to encrypt session cookies. Generate with `openssl rand -hex 32`. Must be at least 32 characters in production. |
| `TODOIST_CLIENT_ID` | **required** | OAuth client ID from the Todoist developer portal. |
| `TODOIST_CLIENT_SECRET` | **required** | OAuth client secret. Keep this value out of version control. |
| `TODOIST_REDIRECT_URI` | **required** | Full callback URL, e.g. `https://your-app.example.com/api/auth/todoist/callback`. Must match the Todoist app registration exactly. |
| `TODOIST_WEBHOOK_SECRET` | recommended | HMAC secret used to verify incoming Todoist webhook signatures. Falls back to `TODOIST_CLIENT_SECRET` if absent. A dedicated webhook secret is strongly preferred. |
| `LOG_LEVEL` | optional | Controls structured log verbosity. One of `debug`, `info`, `warn`, `error`. Defaults to `info`. Set to `debug` only in development. |

---

## 2. Generating Secrets

```bash
# SESSION_SECRET — 32 random bytes, hex-encoded
openssl rand -hex 32

# TODOIST_WEBHOOK_SECRET — 32 random bytes, base64-encoded (matches Todoist's HMAC format)
openssl rand -base64 32
```

---

## 3. Session Cookie Security

The session cookie uses AES-256-GCM encryption. The following flags are set automatically:

- `httpOnly: true` — not accessible from JavaScript
- `sameSite: lax` — mitigates CSRF for most use cases
- `secure: true` — set only when `NODE_ENV === 'production'`; do not skip this in production deployments

For local development, `SESSION_SECRET` defaults to a fixed dev value (`dev-session-secret-change-me`). That value must never be used in production.

---

## 4. OAuth Token Storage

Todoist OAuth access and refresh tokens are encrypted at rest using AES-256-GCM before being written to the `oauth_accounts` database table. The encryption key is derived from `SESSION_SECRET`.

Tokens are never returned to the frontend. The `GET /api/auth/session` endpoint returns only:

```json
{
  "authenticated": true,
  "user": { "id": "...", "email": "...", "displayName": "..." },
  "initialSyncCompleted": true
}
```

---

## 5. Webhook Security

- All incoming webhook payloads are verified against an HMAC-SHA256 signature using `TODOIST_WEBHOOK_SECRET` (falling back to `TODOIST_CLIENT_SECRET`).
- Invalid signatures are rejected with `401` before any processing begins.
- Each delivery is tracked in `webhook_deliveries` with idempotency keys so duplicate deliveries are detected and skipped without double-awarding points.
- Duplicate events are logged as `webhook_duplicate` with stable `deliveryKey` and `eventKey` fields for operational tracing.

---

## 6. Rate Limiting

Rate limiting is applied in-process (single-instance). It is not shared across server instances.

| Route | Strategy | Limit |
|---|---|---|
| `POST /api/todoist/webhook` | per-IP | 100 req/min |
| `GET /api/auth/todoist/callback` | per-IP | 10 req/min |
| `POST /api/rewards/:id/redeem` | per-user | 20 req/min |
| `POST /api/ledger/adjustments` | per-user | 20 req/min |
| `PATCH /api/tasks/:id/metadata` | per-user | 30 req/min |
| `PATCH /api/tasks/metadata/batch` | per-user | 20 req/min |

Exceeded limits return `429 TOO_MANY_REQUESTS`.

**Important:** For horizontal scaling or multi-instance deployments, replace the in-memory bucket store in `server/utils/rate-limit.ts` with a shared backing store (Redis or a dedicated DB table).

---

## 7. Internal Endpoints

The following routes are intended for internal, admin, or development use only and must not be exposed publicly in production:

| Route | Purpose |
|---|---|
| `POST /api/internal/test-auth/session` | Creates a test session — **dev-only, must be disabled in production** |
| `GET /api/internal/test-contract/*` | Contract test fixtures — **dev-only** |
| `POST /api/internal/reconcile` | Nightly reconciliation trigger (not yet implemented — Milestone 15) |

Restrict these routes in production via reverse-proxy allow-lists, environment guards, or network-level firewalls. Do not rely solely on application-level logic for their restriction.

---

## 8. Structured Logging

All server-side events are emitted as JSON lines to stdout/stderr.

### Log levels

Controlled by `LOG_LEVEL` environment variable:

- `debug` — verbose internal state; use in development only
- `info` — normal operational events (default)
- `warn` — unexpected but non-fatal conditions, including rate-limit denials
- `error` — failures requiring attention

### Sensitive field redaction

The following keys are automatically redacted to `[REDACTED]` before any log entry is written:

`authorization`, `access_token`, `refresh_token`, `cookie`, `set-cookie`, `code`, `state`, `password`, `secret`, `token`, `client_secret`, `idempotency_key`, `x-todoist-hmac-sha256`

String values longer than 500 characters are truncated to prevent token blobs from appearing via nested serialization.

### Key structured events

| Event name | Level | Description |
|---|---|---|
| `todoist_sync_started` | info | Initial sync triggered for a user |
| `todoist_sync_completed` | info | Sync completed; includes `projectCount`, `taskCount`, `subtaskCount` |
| `todoist_profile_fetch_failed` | error | Profile fetch from Todoist API failed |
| `oauth_session_established` | info | OAuth flow completed, session set |
| `todoist_sync_kickoff_failed` | error | Background sync failed after OAuth |
| `webhook_received` | info | Webhook delivery received; includes `deliveryKey`, `eventKey` |
| `webhook_ignored` | info/warn | Delivery skipped; includes `reason` and `duplicated` flag |
| `webhook_duplicate` | info | Delivery already processed; observable duplicate event |
| `webhook_processed` | info | Delivery processed; includes `pointsEarned`, `itemType` |
| `reward_redemption_attempt` | info | Redemption started |
| `reward_redemption_idempotent` | info | Duplicate submission resolved to existing redemption |
| `reward_redemption_insufficient_points` | warn | Balance check failed |
| `reward_redemption_succeeded` | info | Redemption committed; includes `newBalance` |
| `rate_limit_exceeded` | warn | Request denied by rate limiter |
| `unhandled_server_error` | error | Unexpected 5xx error in a route handler |

---

## 9. Reconciliation (Milestone 15 — not yet implemented)

When `POST /api/internal/reconcile` is implemented, it will emit a `reconciliation_completed` log event with:

```json
{
  "event": "reconciliation_completed",
  "usersProcessed": 12,
  "awardsMade": 3,
  "duplicatesSkipped": 1,
  "durationMs": 842
}
```

Until then, the shared logging and rate-limiting building blocks added in Milestone 18 are ready for reconciliation to reuse.

---

## 10. Database Migrations

```bash
# Apply pending migrations (do NOT run against production without a backup)
pnpm db:migrate

# Seed development data
pnpm db:seed

# Smoke-test repository layer
pnpm db:smoke
```

---

## 11. Pre-deployment Checklist

- [ ] `SESSION_SECRET` is set to a 32-byte random value (not the dev default)
- [ ] `TODOIST_CLIENT_SECRET` is set and not in version control
- [ ] `TODOIST_WEBHOOK_SECRET` is set to a dedicated value distinct from the client secret
- [ ] `TODOIST_REDIRECT_URI` matches the Todoist app registration exactly
- [ ] `DATABASE_URL` points to the production database
- [ ] `NODE_ENV=production` is set so secure cookies are enabled
- [ ] Internal routes (`/api/internal/*`) are blocked by reverse-proxy or firewall
- [ ] `LOG_LEVEL` is set to `info` or `warn` (not `debug`) in production
- [ ] Log aggregation is configured to receive JSON-line stdout from the app process
- [ ] Rate limiting documentation is reviewed; in-memory limits are acceptable for single-instance
