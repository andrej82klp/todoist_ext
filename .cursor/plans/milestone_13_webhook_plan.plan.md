---
name: Milestone 13 Webhook Plan
targetFile: /workspaces/todoist_ext/.cursor/plans/milestone_13_webhook_plan.plan.md
overview: Implement POST /api/todoist/webhook with Todoist signature verification, delivery and logical-event idempotency, transactional mapping updates plus ledger awards, and focused server tests that prove duplicate-safe processing and one-time bonus behavior.
todos:
  - id: delivery-repo
    content: Add webhook deliveries repository with transaction-safe insert and status updates
    status: completed
  - id: tx-safe-repo-helpers
    content: Add transaction-aware mapping/task/settings lookups used during webhook transaction processing
    status: completed
  - id: webhook-service
    content: Implement webhook orchestration service for signature verification, normalization, dedupe, and award logic
    status: completed
  - id: webhook-route
    content: Add POST /api/todoist/webhook route that reads raw body and validates signature before processing
    status: completed
  - id: webhook-tests
    content: Add milestone webhook tests for invalid signatures and idempotent completion handling
    status: completed
  - id: verification
    content: Run lint, typecheck, db smoke, and full vitest suite
    status: completed
isProject: false
---

# Milestone 13 - Webhook Receiver and Idempotent Completion Processing

## Goals

1. Accept Todoist completion webhooks via a backend-only route.
2. Verify webhook signatures against the exact raw body.
3. Prevent duplicate point awards for delivery retries and logical duplicate events.
4. Award subtask completion points and parent completion bonus exactly once.
5. Keep all balance-affecting writes transactional.

## Scope

Included:
- Route: POST /api/todoist/webhook
- Signature verification: X-Todoist-Hmac-SHA256
- Delivery bookkeeping via webhook_deliveries
- Completion event processing for known users and mapped items
- Transactional updates to mapping status and point ledger/balance
- Dedicated milestone tests

Excluded:
- Streak state updates and milestone streak bonuses (Milestone 14)
- Reconciliation backfill job (Milestone 15)
- Analytics extensions (Milestone 16)
- UI changes

## Data and Idempotency Design

Delivery-level dedupe:
- Primary key used in processing input: deliveryKey
- Source: X-Todoist-Delivery-ID when available
- Fallback: sha256(rawBody)

Logical-event dedupe:
- eventKey built from payload event identity (event_id if present, else stable fallback)
- Used as idempotency input for earned/bonus transaction keys

Ledger idempotency:
- Earned key: todoist_webhook:subtask_completion:{userId}:{todoistItemId}:{eventKey}
- Bonus key: todoist_webhook:task_completion_bonus:{userId}:{parentTodoistItemId}

## Implementation Steps

### 1. Repository additions

File: server/repositories/webhook-deliveries.ts
- Added create/find/update helpers
- Added transaction-safe create and status update methods
- Delivery rows track processing state and payload snapshot

File: server/repositories/item-mappings.ts
- Added findByUserIdAndTodoistItemId
- Added findByUserIdAndTodoistItemIdInTransaction
- Added markCompletionInTransaction

File: server/repositories/tasks.ts
- Added findTaskByTodoistItemId
- Added findTaskByTodoistItemIdInTransaction
- Added getSubtaskCountsInTransaction

File: server/repositories/settings.ts
- Added findByUserIdInTransaction

### 2. Points/ledger transaction behavior

File: server/repositories/ledger.ts
- Added createTransactionAndUpdateBalanceInTransactionIdempotent
- Handles duplicate idempotency keys safely with unique-violation fallback lookup

File: server/services/points/pointsEngineService.ts
- Added transaction-aware award helper for webhook orchestration reuse

### 3. Webhook service orchestration

File: server/services/todoist/webhookService.ts
- Verifies signature with HMAC-SHA256 over raw body
- Parses payload and normalizes completion events
- Resolves local user by Todoist user id
- Inserts delivery row in processing state
- Skips invalid/missing mapping paths as safe no-op outcomes
- Marks completed mapping state
- Processes subtask earned points and one-time parent bonus when all subtasks are completed
- Updates delivery status to processed

Important reliability detail:
- All DB reads/writes during transaction now use the same tx client to avoid nested-client deadlocks.

### 4. Route wiring

File: server/api/todoist/webhook.post.ts
- Reads raw request body
- Reads signature and delivery id headers
- Rejects invalid signatures with 401
- Delegates processing to todoistWebhookService
- Returns success envelope with received: true

### 5. Test coverage

File: tests/server/milestone-13-webhook.test.ts
- Invalid signature returns 401
- Completion events process idempotently with duplicate-safe behavior
- Verifies exactly two earned rows + one bonus row in scenario
- Verifies parent completion state and delivery status persistence

## Verification Checklist

Automated checks run:
1. pnpm lint
2. pnpm typecheck
3. pnpm db:smoke
4. pnpm vitest run

Expected outcome:
- all checks pass
- webhook tests pass
- no regression in existing milestone tests

## Risks and Mitigations

Risk: duplicate awards from retries or duplicate events
- Mitigation: delivery bookkeeping + ledger idempotency keys

Risk: transaction deadlock due nested DB clients
- Mitigation: transaction-aware repository methods used across webhook flow

Risk: malformed/unsigned payloads
- Mitigation: strict signature verification and early 401 rejection

## Acceptance Mapping

Acceptance criterion: invalid signatures are rejected
- Verified by milestone-13-webhook test case and route behavior

Acceptance criterion: duplicate deliveries do not double-award points
- Verified by duplicate delivery scenario and stable ledger row counts

## Completion Notes

Milestone 13 is implemented with backend route, service orchestration, idempotent ledger handling, and passing validation gates.
