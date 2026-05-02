---
name: Milestone 14 Streak Engine Plan
targetFile: /workspaces/todoist_ext/.cursor/plans/milestone_14_streak_engine_plan.plan.md
overview: Implement the streak engine on top of the existing streak, protection, milestone, ledger, and dashboard notification tables by adding transaction-safe streak repositories, a daily evaluation service, webhook and dashboard integration points, focused milestone tests, and an explicit local verification checklist.
todos:
  - id: confirm-rules-and-triggers
    content: Review the PRD, API spec, streak schema, webhook flow, and dashboard summary usage to lock the daily evaluation rules, catch-up trigger points, and milestone bonus semantics
    status: pending
  - id: add-streak-repository
    content: Create a dedicated streaks repository for streak history reads/writes, streak state and protection updates, milestone award dedupe, and notification inserts with transaction-aware helpers
    status: pending
  - id: add-streak-service
    content: Implement streakService.evaluateDay(userId, date) plus transaction-aware internals for qualification checks, protection consumption, milestone rewards, and duplicate-safe state transitions
    status: pending
  - id: wire-write-paths
    content: Integrate streak evaluation into the Todoist webhook completion flow so task-earned points and streak state update in the same transaction
    status: pending
  - id: wire-read-catchup
    content: Add a lightweight catch-up path on dashboard reads so missed days consume protection or break streaks before the user sees stale streak state
    status: pending
  - id: add-tests
    content: Add focused milestone server tests for qualifying days, missed days, protection usage, milestone rewards, duplicate-prevention, and dashboard notification visibility
    status: pending
  - id: verify-locally
    content: Run targeted server tests, lint, typecheck, db smoke, and a manual browser pass that exercises streak continuation, protection, and milestone reward scenarios
    status: pending
  - id: mark-complete
    content: Mark Milestone 14 complete in docs/Implementation-Plan.md only after the automated and manual acceptance checks pass
    status: pending
isProject: false
---

# Milestone 14 - Streak Engine

## Context and Current State

Milestones 9 through 13 established points, ledger, rewards, dashboard notifications, and Todoist webhook completion handling, but the application still has no implemented streak engine.

What already exists:

| Asset | File | Notes |
|---|---|---|
| Streak persistence tables | `server/db/schema.ts` | `streak_state`, `streak_history`, `streak_protection`, `milestone_definitions`, `milestone_awards`, and `dashboard_notifications` already exist |
| Default streak rows | `server/db/defaults.ts` | Seeds streak state and protection defaults for new users |
| Settings reads | `server/repositories/settings.ts` | Can read global settings, milestones, streak state, and protection state but cannot mutate streak data |
| Dashboard streak summary | `server/services/dashboard/dashboardService.ts` | Reads current streak summary and notification banners but does not force stale streak evaluation |
| Ledger transaction helpers | `server/repositories/ledger.ts` | Already supports transaction-aware and idempotent ledger writes needed for milestone bonus awards |
| Webhook completion flow | `server/services/todoist/webhookService.ts` | Already awards completion points transactionally and is the natural write-side integration point for streak advancement |
| Settings surface | `shared/types/domain.ts`, `shared/schemas/settings.ts`, `server/services/settings/settingsService.ts` | Already models streak rule type, rule value, protection settings, and bonus strategy |

What is still missing:

- A repository dedicated to streak history, protection, milestone awards, and banner writes
- A streak domain service that can evaluate one day deterministically
- Write-path integration so webhook-earned points update streak state in the same transaction
- Read-path catch-up so the next-day protection banner and stale streak state resolve even before Milestone 15 adds the nightly job
- Focused milestone tests for rule evaluation, protection, milestone bonuses, and duplicate prevention

## Scope Decisions

### 1. Do not add schema or migration work

Milestone 14 should be implemented entirely on top of the existing tables:

- `streak_state`
- `streak_history`
- `streak_protection`
- `milestone_definitions`
- `milestone_awards`
- `dashboard_notifications`
- `point_ledger`
- `point_balances`

If new persistence is required, that means the design is drifting from the schema already prepared in earlier milestones.

### 2. Keep streak evaluation in the domain layer, not in routes or UI

The milestone requirement is `streakService.evaluateDay(userId, date)`. That public method should become the single place that decides:

- whether a date qualifies
- whether the streak continues, starts, or breaks
- whether protection is consumed
- whether a milestone bonus is awarded
- whether a dashboard notification is created

Routes, pages, and webhook handlers should only trigger it.

### 3. Reuse the existing ledger-first transaction pattern

Milestone rewards are balance-changing events. They must be expressed as ledger rows and balance updates through `ledgerRepository`, not by mutating balances directly.

That means:

- streak milestone bonuses write `bonus` ledger transactions
- milestone dedupe is enforced by `milestone_awards`
- webhook-earned points and streak changes stay inside one DB transaction

### 4. Add lazy read-side catch-up before the nightly job exists

Milestone 15 will add scheduled reconciliation. Until then, the app still needs to:

- consume protection when a qualifying day was missed
- break a streak when protection is unavailable
- show the next-day protection banner on the dashboard

The smallest complete slice is:

- evaluate the earned day inside webhook processing when points are awarded
- run a read-side catch-up on `GET /api/dashboard` before mapping the streak summary

This avoids adding a new internal scheduler early while still satisfying the MVP behavior.

## Rule Decisions to Lock Before Implementation

### 1. Qualification data source

`streak_history` should be the durable per-day record for streak evaluation.

Recommended source metrics for a given `activityDate`:

- `completedCount`: count of app-owned earned completion ledger rows for that day, or a completion count derived from the webhook event currently being processed and then persisted into history
- `pointsEarned`: total positive points earned from completion-driven ledger rows for that day, excluding reward redemption and manual adjustment rows

Recommended qualification rules:

- `completed_items`: qualify when `completedCount >= streakRuleValue`
- `points`: qualify when `pointsEarned >= streakRuleValue`

Do not count:

- reward redemption `spent` rows
- manual adjustments
- milestone bonus ledger rows

Otherwise the user could keep or trigger a streak through non-work activity.

### 2. Evaluation window semantics

`evaluateDay(userId, date)` should evaluate exactly one logical day and persist a unique history row for that date.

Recommended state semantics:

- `lastQualifiedDate`: last date that actually qualified through work, not a protected miss
- `lastEvaluatedDate`: latest date the engine has resolved, whether qualified or not
- `lastProtectionUsedDate`: latest date on which protection was consumed

This distinction matters for duplicate-safe catch-up and for showing whether the current day qualified versus the streak simply survived.

### 3. Protection behavior

If a day does not qualify:

- when `streakProtectionEnabled` is `true` and `streak_protection.balance > 0`, consume one protection day, preserve the current streak length, write a `streak_history` row with `qualified = false` and `protectionConsumed = true`, and create one unacknowledged dashboard notification
- otherwise break the streak by setting `currentStreak = 0` and writing a non-qualified history row with `protectionConsumed = false`

The notification should be additive only once per protected date.

### 4. Milestone reward semantics

Milestone rewards should only trigger when the current streak increases onto a configured active milestone threshold.

Recommended rules:

- reward is emitted when `newCurrentStreak === milestone.days`
- duplicate awards are prevented by the unique `(userId, milestoneDefinitionId)` constraint in `milestone_awards`
- reward writes use `transactionType: 'bonus'`
- fixed strategy uses `milestone.fixedBonusPoints`
- percentage strategy uses the sum of base earned points over the last `global_settings.milestonePercentageWindowDays` qualified days, excluding existing bonus rows, then applies `milestone.percentageBonus`

If the computed percentage bonus is `0`, still treat the milestone as reached but skip the ledger write and record only the evaluation state if that matches the product expectation. Decide this explicitly in tests before implementation.

## Backend Plan

### 1. Add a dedicated streak repository

Create `server/repositories/streaks.ts` instead of overloading `settingsRepository`.

Suggested methods:

- `findStateByUserId(userId)`
- `findStateByUserIdInTransaction(tx, userId)`
- `findProtectionByUserId(userId)`
- `findProtectionByUserIdInTransaction(tx, userId)`
- `findHistoryByUserIdAndDate(userId, activityDate)`
- `findHistoryByUserIdAndDateInTransaction(tx, userId, activityDate)`
- `listHistoryByUserIdBetweenDates(userId, startDate, endDate)`
- `listRecentQualifiedHistoryInTransaction(tx, userId, endDate, limit)`
- `upsertHistoryInTransaction(tx, input)`
- `updateStateInTransaction(tx, userId, updates)`
- `updateProtectionInTransaction(tx, userId, updates)`
- `findAwardByUserIdAndMilestoneIdInTransaction(tx, userId, milestoneId)`
- `createMilestoneAwardInTransaction(tx, input)`
- `createProtectionNotificationInTransaction(tx, input)`
- `findNotificationByUserIdAndProtectedDateInTransaction(tx, userId, protectedDate)` if notification dedupe needs an application-level lookup against `payload`

Repository responsibilities:

- keep all streak-table writes transaction-aware
- centralize unique-row handling for `streak_history` and `milestone_awards`
- avoid direct `getDb()` reads inside transactions, following the Milestone 13 webhook lesson

Implementation note:

- If the repo needs to detect protection-banner duplicates, store `protectedDate` in `dashboard_notifications.payload` and check for an existing unacknowledged or historical notification before inserting another one.

### 2. Implement `streakService.evaluateDay(...)`

Create `server/services/streaks/streakService.ts`.

Recommended public surface:

```ts
streakService.evaluateDay(userId: string, date: string): Promise<StreakEvaluationResult>
```

Recommended internal helpers:

- `evaluateDayInTransaction(tx, userId, date, context)`
- `calculateQualification(ruleType, ruleValue, historyInput)`
- `computeNextStreakLength(previousState, activityDate, qualified, protectionConsumed)`
- `resolveMilestonesToAward(tx, userId, currentStreak, settings)`
- `calculatePercentageBonus(tx, userId, activityDate, windowDays)`
- `ensureEvaluatedThroughDate(userId, date)` for read-side catch-up

Suggested result shape:

```ts
interface StreakEvaluationResult {
  activityDate: string
  qualified: boolean
  qualifiedBy: 'completed_items' | 'points' | null
  currentStreak: number
  longestStreak: number
  protectionConsumed: boolean
  protectionBalance: number
  milestoneAwards: Array<{
    milestoneDays: number
    bonusPoints: number
    ledgerTransactionId: string | null
  }>
}
```

Implementation outline:

1. `await settingsRepository.ensureDefaults(userId)`.
2. Load global settings, streak state, protection row, and active milestones.
3. If a history row already exists for `date`, return the persisted result rather than reevaluating.
4. Determine the day metrics used for qualification.
5. Evaluate qualification from the configured rule.
6. Compute the next streak state:
   - qualified day after prior qualified or protected day increments the streak
   - first-ever qualified day starts at `1`
   - non-qualified day with protection preserves the streak length and decrements protection balance
   - non-qualified day without protection resets current streak to `0`
7. Persist the `streak_history` row.
8. Persist `streak_state` updates including `lastEvaluatedDate`, `lastQualifiedDate`, `lastProtectionUsedDate`, `currentStreak`, and `longestStreak`.
9. If protection was consumed, create exactly one dashboard notification with remaining balance details.
10. Resolve newly reached milestones and award bonus points transactionally through `ledgerRepository.createTransactionAndUpdateBalanceInTransactionIdempotent(...)`.
11. Insert one `milestone_awards` row per awarded milestone.
12. Return the evaluation result.

Important behavior:

- The service must be safe to call multiple times for the same day.
- A protected missed day must not also count as a qualified day.
- A milestone reward must never be emitted twice for the same user milestone.
- Reads inside an outer transaction must use transaction-aware repository helpers only.

### 3. Define how daily metrics are materialized

The key implementation choice is how `streak_history.pointsEarned` and `streak_history.completedCount` get filled.

Recommended approach for this milestone:

- when webhook completion processing awards points for a date, immediately upsert that date's aggregate metrics inside the same transaction
- let `evaluateDayInTransaction(...)` read those same aggregates from `streak_history`
- on read-side catch-up for a day with no earned work, create the missing `streak_history` row with zero metrics and resolve qualification as false

Why this is the smallest stable slice:

- it avoids adding a second event journal or analytics table
- it gives `evaluateDay` one durable per-day record to read and update
- it keeps nightly reconciliation in Milestone 15 free to recompute or backfill the same row shape

This likely means `streaksRepository.upsertHistoryInTransaction(...)` must support aggregate increments for:

- `pointsEarned`
- `completedCount`
- optional `qualified`, `qualifiedBy`, `streakLength`, and `protectionConsumed` fields once evaluation resolves the day

### 4. Wire streak evaluation into webhook processing

Update `server/services/todoist/webhookService.ts`.

Recommended integration point:

- after completion-earned ledger rows and any parent completion bonus have been created
- before the webhook delivery is marked processed
- inside the same transaction client already used for point writes

Recommended flow adjustment:

1. Determine the logical activity date from the Todoist completion event timestamp.
2. Increment the day aggregates for that user/date in `streak_history`.
3. Call `streakService.evaluateDayInTransaction(tx, userId, activityDate, { source: 'todoist_webhook' })`.
4. Continue to final delivery bookkeeping.

This satisfies the architecture rule that point awards and streak changes are atomic.

### 5. Add read-side catch-up to the dashboard service

Update `server/services/dashboard/dashboardService.ts` to prevent stale streak summaries.

Recommended behavior before reading streak state and notifications:

```ts
await streakService.ensureEvaluatedThroughDate(userId, yesterdayKey())
```

Catch-up rules:

- walk forward from `lastEvaluatedDate + 1 day` through yesterday
- stop at yesterday so today does not break early before the user still has time to qualify
- for each unevaluated day with no persisted work aggregates, evaluate it as a missed day
- let the normal protection or break logic run

Why dashboard is the right first read hook:

- it already shows the streak summary and protection banner
- it avoids widening scope into every authenticated route
- it delivers the required “next day” protection banner without waiting for Milestone 15

Optional second hook if needed:

- `GET /api/auth/session` can also call the same catch-up helper if the dashboard is not guaranteed to be the first screen after login. Keep this optional unless manual verification shows stale state remains visible.

### 6. Keep milestone bonus math isolated and testable

Percentage bonuses are the part most likely to drift.

Recommended helper contract:

```ts
calculatePercentageBonus(basePointsWindowTotal: number, percentageBonus: string | number): number
```

Rules to lock in tests:

- base window uses only non-bonus earned completion points
- reward redemptions and manual adjustments are excluded
- milestone bonus rows are excluded from later milestone window totals
- rounding behavior is explicit and consistent, preferably integer-rounded once at the end

If the current codebase has an established integer rounding rule in `pointsEngineService`, mirror it instead of inventing a new one.

## Test Plan

### 1. Add a dedicated milestone test file

Create `tests/server/milestone-14-streaks.test.ts`.

Follow the same in-process H3 server pattern already used by the milestone route tests.

Mount at minimum:

- `POST /api/internal/test-auth/session`
- `POST /api/todoist/webhook`
- `GET /api/dashboard`

Use direct repository setup where that is simpler than building full UI flows.

### 2. Suggested test matrix

| Test case | Expected |
|---|---|
| first qualifying completion day under `completed_items` rule | streak becomes `1`, longest becomes `1`, history row records `qualified = true` |
| second consecutive qualifying day | streak increments and longest updates |
| non-consecutive qualifying day after a true break | streak restarts at `1` |
| missed day with protection enabled and balance available | streak preserved, protection decremented, one protection notification created |
| missed day with protection disabled | streak resets to `0`, no protection notification |
| missed day with protection enabled but zero balance | streak resets to `0`, no protection notification |
| `points` rule qualifies only after minimum earned points threshold | below-threshold day stays unqualified, above-threshold day qualifies |
| dashboard catch-up across an unevaluated missed day | `GET /api/dashboard` consumes protection or breaks streak before returning summary |
| reaching a 7-day milestone under fixed strategy | one `bonus` ledger row and one `milestone_awards` row are created |
| same milestone re-evaluated again | no duplicate ledger row and no duplicate award row |
| reaching a percentage-based milestone | bonus amount matches the configured 5-day base-points window |
| duplicate Todoist webhook delivery for the same completion | no duplicate streak-history increments, no duplicate milestone reward, no duplicate protection event |
| protected day notification acknowledgement path remains compatible | `GET /api/dashboard` shows the banner and existing acknowledge route can dismiss it |

Assertions that matter most:

- `streak_state.current_streak` changes exactly as expected
- `streak_state.longest_streak` only increases, never decreases
- `streak_state.last_qualified_date` changes only on actually qualified days
- `streak_protection.balance` decrements exactly once per protected date
- `dashboard_notifications` contains one protection banner per protected date
- `point_ledger` contains exactly one milestone bonus transaction per milestone definition

### 3. Add lower-level repository/service tests only if needed

If the server milestone tests become too indirect for percentage window math or catch-up sequencing, add a focused Vitest service test beside the server tests. Prefer not to split unless a pure service test materially reduces setup noise.

## Verification Steps

### Automated

Run all of the following from the repo root:

1. `pnpm lint`
2. `pnpm typecheck`
3. `pnpm db:smoke`
4. `pnpm vitest run tests/server/milestone-13-webhook.test.ts tests/server/milestone-14-streaks.test.ts tests/server/milestone-12-dashboard.test.ts`

Optional broader regression when the milestone is close to done:

5. `pnpm vitest run`

### Manual

1. Start the app with `pnpm dev`.
2. Authenticate as a dev test user.
3. Configure streak settings once for a simple scenario, for example `completed_items` with value `1`.
4. Trigger a qualifying completion through the existing Todoist test flow or a controlled fixture path.
5. Open `/` and confirm the streak card increases.
6. Seed or simulate a missed next day with available protection, then refresh `/`.
7. Confirm the dashboard shows the protection banner and the protection balance decreased by exactly one.
8. Dismiss the banner and confirm it no longer appears.
9. Continue qualifying days until a configured milestone is reached.
10. Confirm the points summary increases by the milestone bonus and the recent transactions list shows a `bonus` entry.
11. Re-send the same webhook delivery or logical duplicate event.
12. Confirm the streak, milestone award count, and bonus ledger rows do not change a second time.

## Implementation Order

1. Confirm the qualification metrics, protected-day semantics, and percentage-bonus rounding rules.
2. Add `server/repositories/streaks.ts` with transaction-safe reads and writes.
3. Implement `server/services/streaks/streakService.ts` with public evaluation and read-side catch-up helpers.
4. Wire webhook processing to update per-day aggregates and invoke streak evaluation inside the existing transaction.
5. Wire dashboard reads to run stale-day catch-up before building the summary.
6. Add the milestone server tests and get them passing before any optional polish.
7. Run lint, typecheck, db smoke, and the targeted milestone suite.
8. Run the manual dashboard verification for protection and milestone reward scenarios.
9. Mark Milestone 14 complete in `docs/Implementation-Plan.md` only after acceptance criteria pass.

## Acceptance Criteria

- qualifying work advances the streak under both supported rule types
- current streak, longest streak, and last qualified date are persisted correctly
- protection is consumed automatically once when appropriate
- the next dashboard load shows one acknowledgement-required protection banner
- milestone bonuses are awarded exactly once and create bonus ledger rows
- duplicate webhook deliveries or reevaluations do not create duplicate streak history, duplicate protection events, or duplicate milestone rewards

## Diagram

```mermaid
flowchart TD
    WH[Todoist webhook] --> TX[Webhook transaction]
    TX --> AGG[Upsert streak_history day aggregates]
    TX --> EVAL[streakService.evaluateDayInTransaction]
    EVAL --> QUAL{Day qualifies?}
    QUAL -->|yes| STATE[Update streak_state]
    QUAL -->|no + protection| PROTECT[Consume streak_protection]
    QUAL -->|no + no protection| BREAK[Reset current streak]
    PROTECT --> NOTE[Create dashboard notification]
    STATE --> MILESTONE{Reached active milestone?}
    MILESTONE -->|yes| BONUS[Create bonus ledger row + milestone_award]
    MILESTONE -->|no| DONE[Persist evaluation]
    BONUS --> DONE
    DASH[GET /api/dashboard] --> CATCHUP[ensureEvaluatedThroughDate(yesterday)]
    CATCHUP --> SUMMARY[Return fresh streak summary + notifications]
```