---
name: Milestone 18 Hardening Security and Observability Plan
overview: Harden the existing OAuth, sync, webhook, rewards, settings, tasks, and ledger flows by adding a shared structured-logging foundation with secret redaction, instrumenting the critical business paths and duplicate-safe webhook outcomes, tightening abuse protection on public and high-value endpoints, proving every write route preserves validation and user scoping, confirming all balance-affecting writes remain transactional, and documenting deployment/runtime safeguards without expanding this milestone into implementing the skipped reconciliation job itself.
todos:
  - id: confirm-m18-scope
    content: Lock Milestone 18 to hardening existing flows and reconciliation observability scaffolding only, without pulling the skipped reconciliation job implementation into this slice
    status: done
  - id: add-logging-foundation
    content: Introduce a shared server-side logger and request context helper that emit structured events, attach request metadata, and redact tokens, secrets, cookies, auth headers, OAuth codes, and state values before anything reaches logs
    status: done
  - id: instrument-critical-flows
    content: Add structured outcome logging to OAuth start/callback, Todoist sync, webhook processing, reward redemption, point awards, streak bonuses, and any reconciliation entrypoint or placeholder hook that already exists
    status: done
  - id: remove-leaky-log-paths
    content: Replace ad hoc console logging and audit response/session surfaces so Todoist tokens and other secrets never leak to the frontend or to server logs
    status: done
  - id: add-abuse-protection
    content: Add reusable rate or abuse limiting for the webhook route, OAuth callback flow, reward redemption, ledger adjustments, and metadata batch write endpoints, with route-appropriate keys and 429 behavior
    status: done
  - id: audit-write-routes
    content: Enumerate every POST, PATCH, and DELETE route and prove each one keeps schema validation, authentication, and owner scoping invariants intact after the hardening changes
    status: done
  - id: verify-transactional-writes
    content: Confirm every balance-changing flow still executes inside one DB transaction and extend tests for duplicate-safe or concurrent execution where the current coverage is thin
    status: done
  - id: document-operations
    content: Add a deployment and operations checklist covering required env vars, log configuration, webhook secret handling, rate-limit tuning, and internal endpoint restrictions
    status: done
  - id: add-hardening-tests
    content: Create milestone 18 server coverage for validation failures, scoping failures, secret redaction, duplicate webhook observability, and rate limiting, while extending existing milestone tests only where necessary
    status: done
  - id: verify-and-close
    content: Run lint, typecheck, DB smoke, targeted server tests, optional browser verification of auth/session surfaces, then mark Milestone 18 complete in docs/Implementation-Plan.md once the acceptance criteria are proven
    status: done
isProject: false
---

# Milestone 18 — Hardening, Security, and Observability

## Context and Current State

Milestones 5 through 17 built the main OAuth, sync, task metadata, rewards, dashboard, webhook, streak, analytics, and task UI flows. Milestone 18 is the hardening pass that closes the operational gaps before end-to-end MVP validation.

What already exists:

| Asset | File | Notes |
|---|---|---|
| Central API wrapper | `server/utils/api.ts` | `defineApiHandler(...)` already normalizes errors and is the best insertion point for request-scoped error logging |
| Request validation helpers | `server/utils/validation.ts` | `parseBodyWithSchema(...)` and `parseQueryWithSchema(...)` already enforce Zod validation on most write routes |
| Session and auth enforcement | `server/utils/session.ts`, `server/middleware/session.ts` | Protected routes already rely on encrypted cookie sessions and `requireCurrentUser(...)` |
| OAuth token storage | `server/utils/secrets.ts`, `server/db/schema.ts` | OAuth tokens are encrypted at rest; `tests/server/milestone-5-oauth.test.ts` already proves they are not stored in plaintext |
| OAuth route and callback | `server/api/auth/todoist/start.get.ts`, `server/api/auth/todoist/callback.get.ts`, `server/services/todoist/oauth.ts` | Functional, but logging is ad hoc and not redaction-aware |
| Initial sync | `server/services/todoist/todoistSyncService.ts`, `server/services/todoist/sync.ts` | Functional, but has no structured success or failure audit trail |
| Webhook processing | `server/api/todoist/webhook.post.ts`, `server/services/todoist/webhookService.ts`, `server/repositories/webhook-deliveries.ts` | Signature verification and duplicate-safe processing exist, but observability is minimal and duplicate outcomes are not surfaced cleanly |
| Reward redemption | `server/api/rewards/[rewardId]/redeem.post.ts`, `server/services/rewards/rewardsService.ts` | Transactional and idempotent already, but redemption attempts and conflicts are not logged in a structured way |
| Points and streak writes | `server/services/points/pointsEngineService.ts`, `server/services/streaks/streakService.ts`, `server/repositories/ledger.ts` | Balance-affecting writes already use transactional helpers that must remain the authoritative pattern |
| Existing security tests | `tests/server/milestone-3-contracts.test.ts`, `tests/server/milestone-4-session.test.ts`, `tests/server/milestone-5-oauth.test.ts`, `tests/server/milestone-11-redemption.test.ts`, `tests/server/milestone-13-webhook.test.ts` | Good base coverage for validation, auth, encryption, ownership, and webhook idempotency |

What is still missing (at plan time):

- A shared structured logger with redaction rules and request context
- Consistent outcome logging for OAuth, sync, webhook, awards, redemptions, and error paths
- Basic rate or abuse protection for public or high-value write endpoints
- One milestone-specific test suite that proves validation, scoping, secrecy, and observability expectations together
- Deployment and runtime documentation for logging, secrets, and endpoint protection
- A clear dependency rule for reconciliation, because Milestone 15 remains skipped

## Scope Decisions

### 1. Build observability through shared server utilities, not one-off route logging

The lowest-risk way to add observability is to introduce one shared logger and one request-context helper, then route all new logging through those abstractions.

Responsibilities:

- `server/utils/logger.ts` owns structured log emission and redaction rules
- `server/utils/api.ts` attaches route, method, request id, and normalized failure metadata for handler-level failures
- A small request-context helper derives `requestId`, `path`, `method`, `ip`, and `userId` when available so services do not each reinvent that logic

Why this approach is preferred:

- It keeps redaction in one place
- It avoids a second cleanup pass for inconsistent field names
- It makes duplicate webhook and redemption events queryable by stable fields instead of freeform strings

### 2. Keep the rate-limiting slice intentionally basic and MVP-appropriate

There is currently no rate-limiting middleware or abuse guard in the repo. Milestone 18 adds the minimum effective protection for a modular-monolith MVP.

Approach:

- Introduce a reusable server helper `server/utils/rate-limit.ts`
- Key unauthenticated/public routes by client IP or forwarded-for value
- Key authenticated write routes by `userId`, optionally including route name for isolation
- Return a consistent `429` error shape via existing API error helpers
- Clearly document that any in-memory limiter is single-instance only

Route priority order (highest to lowest risk):

1. `POST /api/todoist/webhook`
2. `GET /api/auth/todoist/callback`
3. `POST /api/rewards/:rewardId/redeem`
4. `POST /api/ledger/adjustments`
5. `PATCH /api/tasks/metadata/batch`
6. `PATCH /api/tasks/:taskId/metadata`

### 3. Treat reconciliation as a dependency boundary, not an excuse to reopen Milestone 15

Milestone 18 requires reconciliation outcomes to be observable, but the actual reconciliation job is still marked skipped in `docs/Implementation-Plan.md`.

Boundary:

- `POST /api/internal/reconcile` is absent, so the full job is not implemented here
- The shared logging and internal-endpoint protection building blocks added here are sufficient for reconciliation to reuse later
- Expected log fields are documented in `docs/DEPLOYMENT.md` for the future route

### 4. Verify invariants through one explicit route audit

Route-by-route audit covers:

- Auth requirement: `requireCurrentUser(...)` or explicit internal-only gate
- Schema validation: `parseBodyWithSchema(...)` or `parseQueryWithSchema(...)`
- Ownership check: service or repository enforces `userId` match for resource-specific writes
- Error shape consistency: all errors return via `defineApiHandler` catch block
- Rate-limit need or explicit exemption

Audit results (as implemented):

| Route | Auth | Schema | Scoping | Rate limit |
|---|---|---|---|---|
| `POST /api/rewards` | ✅ | ✅ | ✅ user.id | — |
| `PATCH /api/rewards/:id` | ✅ | ✅ | ✅ userId === existing.userId | — |
| `DELETE /api/rewards/:id` | ✅ | — | ✅ userId === existing.userId | — |
| `POST /api/rewards/:id/redeem` | ✅ | — (idempotency header only) | ✅ rewardId + userId | ✅ per-user |
| `PATCH /api/settings` | ✅ | ✅ | ✅ user.id | — |
| `POST /api/ledger/adjustments` | ✅ | ✅ | ✅ user.id | ✅ per-user |
| `PATCH /api/tasks/:taskId/metadata` | ✅ | ✅ | ✅ user.id | ✅ per-user |
| `PATCH /api/tasks/metadata/batch` | ✅ | ✅ | ✅ user.id | ✅ per-user |
| `POST /api/dashboard/notifications/:id/acknowledge` | ✅ | — | ✅ user.id | — |
| `POST /api/auth/logout` | ✅ | — | n/a | — |
| `POST /api/todoist/webhook` | HMAC signature | raw body | none (public) | ✅ per-IP |
| `GET /api/auth/todoist/callback` | state cookie | Zod query | none (public) | ✅ per-IP |

## Files Created or Modified

### New files

- `server/utils/logger.ts` — structured logger with redaction
- `server/utils/rate-limit.ts` — in-process rate limiter helper
- `tests/server/milestone-18-hardening.test.ts` — milestone test suite
- `docs/DEPLOYMENT.md` — deployment and operations checklist

### Modified files

- `server/utils/api.ts` — log unhandled 5xx errors, add `tooManyRequestsError` helper
- `shared/constants/api.ts` — add `TOO_MANY_REQUESTS` status and message constants
- `server/services/todoist/oauth.ts` — replace `console.error` with structured logger
- `server/api/auth/todoist/callback.get.ts` — structured logging + per-IP rate limit
- `server/services/todoist/todoistSyncService.ts` — structured sync outcome logging
- `server/services/todoist/webhookService.ts` — structured delivery, duplicate, and award logging
- `server/services/rewards/rewardsService.ts` — structured redemption logging
- `server/api/todoist/webhook.post.ts` — per-IP rate limit
- `server/api/rewards/[rewardId]/redeem.post.ts` — per-user rate limit
- `server/api/ledger/adjustments.post.ts` — per-user rate limit
- `server/api/tasks/metadata/batch.patch.ts` — per-user rate limit
- `server/api/tasks/[taskId]/metadata.patch.ts` — per-user rate limit
- `.env.example` — document new optional env vars

## Step-by-Step Implementation Plan

### Phase 1. Shared hardening primitives

1. Create `server/utils/logger.ts` with structured JSON output, redaction of sensitive keys, and `LOG_LEVEL` env control.
2. Create `server/utils/rate-limit.ts` with `createRateLimiter(options)` and `checkRateLimit(limiter, event, strategy, userId?)`.
3. Add `TOO_MANY_REQUESTS` to `shared/constants/api.ts` error status and message maps.
4. Update `server/utils/api.ts` to add `tooManyRequestsError(...)` helper and log unhandled 5xx errors in `defineApiHandler`.

### Phase 2. Instrument critical business flows

1. `server/services/todoist/oauth.ts` — replace `console.error` with `logger.error`; add `logger.info` for token exchange, profile fetch, and sync start outcomes.
2. `server/api/auth/todoist/callback.get.ts` — add per-IP rate limit, add `logger.info` on session establishment and `logger.error` on sync kickoff failure.
3. `server/services/todoist/todoistSyncService.ts` — log sync start, success with counts, and failure.
4. `server/services/todoist/webhookService.ts` — log receipt, signature result, ignored events, duplicate-delivery outcome, and points awarded totals.
5. `server/services/rewards/rewardsService.ts` — log redemption attempt, idempotent retry, insufficient balance conflict, and successful redemption.

### Phase 3. Apply route-level abuse protection

1. Add per-IP rate limiter to `server/api/todoist/webhook.post.ts`.
2. Add per-IP rate limiter to `server/api/auth/todoist/callback.get.ts`.
3. Add per-user rate limiter to `server/api/rewards/[rewardId]/redeem.post.ts`.
4. Add per-user rate limiter to `server/api/ledger/adjustments.post.ts`.
5. Add per-user rate limiter to `server/api/tasks/metadata/batch.patch.ts`.
6. Add per-user rate limiter to `server/api/tasks/[taskId]/metadata.patch.ts`.

### Phase 4. Tests

Create `tests/server/milestone-18-hardening.test.ts` to cover:

- Validation failures return `422` for all write endpoints
- Cross-user access returns `404`, not `403` (existing pattern)
- `GET /api/auth/session` never exposes access or refresh tokens in response body
- Rate limiter helper unit tests verify correct `true`/`false` behavior
- Logger redaction unit tests verify sensitive keys are masked in output
- Webhook duplicate delivery outcome is observable (structured log or delivery record)

### Phase 5. Documentation and closure

1. Create `docs/DEPLOYMENT.md` with deployment checklist, env var guide, and rate-limit tuning notes.
2. Update `.env.example` with `LOG_LEVEL` and `TODOIST_WEBHOOK_SECRET` comments.
3. Mark Milestone 18 complete in `docs/Implementation-Plan.md`.

## Verification Checklist

### Automated

```bash
pnpm lint
pnpm typecheck
pnpm db:smoke
pnpm vitest run tests/server/milestone-18-hardening.test.ts
pnpm vitest run tests/server/milestone-5-oauth.test.ts tests/server/milestone-11-redemption.test.ts tests/server/milestone-13-webhook.test.ts tests/server/milestone-14-streaks.test.ts
```

### Manual

1. Complete the Todoist OAuth connect flow and inspect `GET /api/auth/session` — no access/refresh tokens in response.
2. Check server logs during OAuth — `code`, `state`, `access_token`, `cookie` keys must appear as `[REDACTED]` or not appear at all.
3. Replay the same webhook payload twice — confirm the second delivery is logged as duplicate with the same `deliveryKey`.
4. Attempt >20 redemptions in quick succession (dev tool or script) — confirm 429 responses.
5. Trigger initial sync — confirm log includes `projectCount`, `taskCount`, `subtaskCount` with no token values.

## Acceptance Mapping

| Criterion | How it is proven |
|---|---|
| Invalid input is consistently rejected | Milestone 18 validation tests return `422` for every write endpoint with malformed bodies |
| Tokens never leak to the frontend | Session route test + manual network inspection: no `accessToken`, `refreshToken`, or `cookie` in API responses |
| Webhook duplicates are observable | Webhook duplicate test + logger spy confirms structured duplicate event with stable `deliveryKey` field |

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Logging inside transactions complicates rollback reasoning | Log at service entry/exit boundaries, not inside ledger mutation helpers |
| In-memory rate limiter gives false confidence at scale | Document single-instance limitation; keep abstraction replaceable |
| Milestone silently absorbs reconciliation work | Scope is locked to instrumentation scaffolding only |
| Logger test assertions break on log format changes | Spy on structured event names and specific fields, not full serialized strings |
