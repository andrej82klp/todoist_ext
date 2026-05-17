---
name: Milestone 12 Dashboard Plan
overview: Implement the dashboard backend and home-page UI without new schema work by aggregating existing points, streak, tasks, rewards, and notification data into `GET /api/dashboard`, wiring notification acknowledgement, replacing the dashboard placeholder page, and adding focused contract tests plus local verification.
todos:
  - id: confirm-contract
    content: Review the dashboard API contract, existing streak/settings tables, and page placeholders to lock the milestone scope and avoid pulling Milestone 14 logic forward
    status: completed
  - id: add-dashboard-types
    content: Extend shared domain types with dashboard summary, task card, reward progress, and notification contracts that mirror the API spec
    status: completed
  - id: add-dashboard-data-access
    content: Create a dashboard repository for notifications and any helper queries needed for acknowledgement and active-banner reads
    status: completed
  - id: add-dashboard-service
    content: Create a dashboard service that aggregates points, streak summary, today's tasks, recent transactions, reward progress, and notifications from existing repositories in one call
    status: completed
  - id: add-dashboard-routes
    content: Create GET /api/dashboard and POST /api/dashboard/notifications/:notificationId/acknowledge route handlers using the new service
    status: completed
  - id: build-dashboard-ui
    content: Replace app/pages/index.vue with a full dashboard page driven by one useFetch call, including cards, empty states, quick links, and acknowledgement banner actions
    status: completed
  - id: add-tests
    content: Add focused server contract tests for unauthenticated access, empty dashboard state, populated dashboard aggregation, ownership scoping, and notification acknowledgement
    status: completed
  - id: verify-locally
    content: Run targeted tests, lint, typecheck, and the finish-milestone local smoke checklist including a live browser pass and session-aware route navigation
    status: pending
  - id: mark-complete
    content: Mark Milestone 12 complete in docs/Implementation-Plan.md after acceptance criteria and verification pass
    status: pending
isProject: false
---

# Milestone 12 — Dashboard API and Dashboard UI

## Context and Current State

Milestones 10 and 11 completed the points, rewards, and redemption loop, but the primary home screen still has no real implementation.

What already exists:

| Asset | File | Notes |
|---|---|---|
| Dashboard page stub | `app/pages/index.vue` | Still renders `AppPagePlaceholder` |
| Dashboard route folder | `server/api/dashboard/` | Empty |
| Points summary source | `server/repositories/ledger.ts`, `server/services/points/pointsEngineService.ts` | Can return balance and recent ledger transactions |
| Streak state and protection tables | `server/db/schema.ts`, `server/repositories/settings.ts` | State, protection balance, and settings rows already exist |
| Task enrichment | `server/repositories/tasks.ts`, `server/services/tasks/taskAssemblyService.ts` | Can build enriched tasks with deadline, progress, and estimated points |
| Rewards data | `server/repositories/rewards.ts`, `server/services/rewards/rewardsService.ts` | Can read active rewards and current affordability inputs |
| Notification persistence | `server/db/schema.ts` | `dashboard_notifications` table already exists but has no repository/service usage yet |

What is missing:

- Shared dashboard response types
- Notification read + acknowledge data access
- A dashboard aggregation service
- `GET /api/dashboard`
- `POST /api/dashboard/notifications/:notificationId/acknowledge`
- A real dashboard UI on `/`
- Focused server contract tests for the new routes

## Scope Decisions

### 1. Do not add schema or migration work

Milestone 12 can be completed from the existing schema. The tables needed for this slice already exist:

- `point_balances`
- `point_ledger`
- `streak_state`
- `streak_protection`
- `global_settings`
- `milestone_definitions`
- `todoist_item_mappings`
- `dashboard_notifications`
- `rewards`

If new persistence is required, that would mean the scope has drifted into later milestones and should be rejected.

### 2. Keep dashboard aggregation read-only except notification acknowledgement

`GET /api/dashboard` should only aggregate existing data. The only write in this milestone is acknowledgement, which sets `acknowledgedAt` on an existing notification row owned by the current user.

### 3. Reuse existing task and points mappers

Do not reimplement point calculation, deadline formatting, or ledger row mapping inside the dashboard service. Reuse:

- `taskAssemblyService.buildEnrichedTaskList(...)`
- `pointsEngineService.balanceRowToSummary(...)`
- `pointsEngineService.ledgerRowToDomain(...)`

This keeps the dashboard contract aligned with the Tasks and Ledger APIs.

## Backend Plan

### 1. Extend shared domain types

Update `shared/types/domain.ts` to add the dashboard contract used by both the API and the page.

Recommended additions:

- `DashboardTaskSummary`
- `DashboardRewardProgress`
- `DashboardNotification`
- `DashboardSummary`

Suggested shapes:

```ts
export interface DashboardTaskSummary {
  id: string
  todoistTaskId: string
  title: string
  deadline: string | null
  priority: PriorityLevel
  difficulty: number
  estimatedPoints: number
  progressPercent: number | null
}

export interface DashboardRewardProgress {
  closestReward: {
    id: string
    name: string
    costPoints: number
    pointsNeeded: number
  } | null
}

export interface DashboardNotification {
  id: string
  type: 'streak_protection_used' | 'system'
  severity: 'info' | 'warning' | 'critical'
  title: string
  message: string
  requiresAcknowledgement: boolean
  createdAt: string
}

export interface DashboardSummary {
  points: PointsSummary
  streak: StreakSummary
  todayTasks: DashboardTaskSummary[]
  recentTransactions: LedgerTransaction[]
  rewardProgress: DashboardRewardProgress
  notifications: DashboardNotification[]
}
```

Keep `title` on notifications even though the API example omits it; the UI can use it without breaking the documented surface because it is additive.

### 2. Add a dashboard repository

Create `server/repositories/dashboard.ts` with only notification-focused persistence helpers.

Methods:

- `listActiveNotificationsByUserId(userId: string, limit = 5)`
  - returns unacknowledged notifications ordered by newest first
- `findNotificationById(userId: string, notificationId: string)`
  - scopes by user ownership
- `acknowledgeNotification(userId: string, notificationId: string)`
  - sets `acknowledgedAt = new Date()` and `updatedAt = new Date()`
  - returns the updated row or `null`

Important behavior:

- acknowledgement must be idempotent
- cross-user access must resolve as `404`

### 3. Add a dashboard service

Create `server/services/dashboard/dashboardService.ts`.

It should aggregate the dashboard in one public call:

```ts
dashboardService.getDashboard(userId: string): Promise<DashboardSummary>
```

Implementation outline:

1. `await settingsRepository.ensureDefaults(userId)`
2. Parallel read:
   - `ledgerRepository.getBalanceByUserId(userId)`
   - `ledgerRepository.listByUserIdPaginated(userId, 1, 5)`
   - `settingsRepository.findByUserId(userId)`
   - `settingsRepository.findMilestonesByUserId(userId)`
   - `settingsRepository.findStreakStateByUserId(userId)`
   - `settingsRepository.findStreakProtectionByUserId(userId)`
   - `tasksRepository.findTasksWithMeta(userId, { includeCompleted: false })`
   - `rewardsRepository.listByUserIdPaginated(userId, false, 1, 100)`
   - `dashboardRepository.listActiveNotificationsByUserId(userId, 5)`
3. Map points and recent transactions with `pointsEngineService`
4. Build the streak summary from settings + state + protection:
   - `current` from `streak_state.current_streak`
   - `longest` from `streak_state.longest_streak`
   - `protectionBalance` from `streak_protection.balance`
   - `ruleType` and `ruleValue` from `global_settings`
   - `nextMilestone` from the nearest active milestone with `days > currentStreak`
5. Build enriched task list with `taskAssemblyService.buildEnrichedTaskList(...)`
6. Reduce enriched tasks to `todayTasks` by keeping incomplete tasks whose `deadline` is today or overdue, then sort by:
   - earliest deadline first
   - higher priority first
   - higher estimated points first
   - cap to 5
7. Compute `rewardProgress.closestReward` from active rewards and current balance:
   - choose the reward with the smallest `pointsNeeded`
   - break ties on lower `costPoints`, then earliest `createdAt`
   - if no active rewards exist, return `null`
8. Map notifications to the dashboard domain shape

Also add:

```ts
dashboardService.acknowledgeNotification(userId: string, notificationId: string)
```

Behavior:

- if the notification is missing or belongs to another user, throw `notFoundError('Notification not found')`
- otherwise acknowledge it and return `{ success: true, notificationId }`

### 4. Add dashboard routes

Create:

- `server/api/dashboard/index.get.ts`
- `server/api/dashboard/notifications/[notificationId]/acknowledge.post.ts`

Both routes should follow the existing `defineApiHandler` + `requireCurrentUser` pattern.

Route expectations:

#### `GET /api/dashboard`

```ts
export default defineApiHandler(async (event) => {
  const user = await requireCurrentUser(event)
  const dashboard = await dashboardService.getDashboard(user.id)
  return success(dashboard)
})
```

#### `POST /api/dashboard/notifications/:notificationId/acknowledge`

```ts
export default defineApiHandler(async (event) => {
  const user = await requireCurrentUser(event)
  const notificationId = getRouterParam(event, 'notificationId')

  if (!notificationId) {
    throw badRequestError('Notification id is required')
  }

  return success(await dashboardService.acknowledgeNotification(user.id, notificationId))
})
```

## UI Plan

### 1. Replace the dashboard placeholder page

Rewrite `app/pages/index.vue` to use one dashboard fetch:

```ts
const { data, pending, error, refresh } = await useFetch<{ data: DashboardSummary }>('/api/dashboard', {
  credentials: 'include'
})
```

Use computed accessors instead of duplicating state.

### 2. Build the dashboard sections

The page should include the following visible slices:

- Hero / summary section with current balance and quick links
- Streak card with current streak, longest streak, protection balance, and next milestone progress
- Today’s tasks card list with empty state and quick link to `/tasks`
- Recent transactions card with empty state and quick link to `/rewards`
- Reward progress card highlighting the closest reward and points still needed
- Notification banner area that renders active notifications and supports acknowledgement

### 3. Notification acknowledgement behavior

For each notification with `requiresAcknowledgement === true`, render a dismiss button that:

1. calls `POST /api/dashboard/notifications/:notificationId/acknowledge`
2. keeps a local `acknowledgingId` to prevent duplicate submits
3. refreshes the dashboard payload after success
4. shows inline error feedback if the request fails

### 4. Empty-state expectations

The page must render stable empty states when there is no data for:

- today’s tasks
- recent transactions
- rewards
- notifications

Empty states should still provide navigation to `/tasks`, `/rewards`, or `/settings` where relevant.

## Test Plan

Create `tests/server/milestone-12-dashboard.test.ts`.

Minimum coverage:

1. `GET /api/dashboard` returns `401` when unauthenticated
2. `POST /api/dashboard/notifications/:id/acknowledge` returns `401` when unauthenticated
3. Fresh authenticated user gets:
   - zeroed `points`
   - zero streak values
   - `todayTasks = []`
   - `recentTransactions = []`
   - `rewardProgress.closestReward = null`
   - `notifications = []`
4. Populated user gets a correctly aggregated dashboard with:
   - points summary from ledger
   - streak summary from defaults/seeded rows
   - only due-today or overdue tasks in `todayTasks`
   - recent transactions ordered newest first
   - closest reward progress based on current balance
   - active notifications only
5. Acknowledge route:
   - returns success for owned notification
   - removes the notification from the next `GET /api/dashboard`
   - returns `404` for missing or cross-user notification

Keep the test server wiring consistent with Milestones 10 and 11 by using `createApp`, `createRouter`, `sessionMiddleware`, and `internal/test-auth/session`.

## Verification Plan

Current verification status on 2026-05-01:

- `pnpm lint` passed
- `pnpm typecheck` passed
- Dashboard UI rendered locally at `http://localhost:3000/`
- Todoist login reached the OAuth permission screen successfully
- Final callback into the local app returned `500`, and DB-backed tests timed out due external database connectivity (`CONNECT_TIMEOUT` against the configured Neon host)
- Because of that environment issue, Milestone 12 should not be marked complete yet

After implementation:

1. Run the focused contract suite:
   - `pnpm exec vitest run tests/server/milestone-12-dashboard.test.ts`
2. Run baseline smoke coverage:
   - `pnpm db:smoke`
3. Run static checks:
   - `pnpm lint`
   - `pnpm typecheck`
4. Run the finish-milestone browser checklist:
   - verify a single dev server on port `3000`
   - open `http://localhost:3000/`
   - authenticate with Todoist using `.secrets/todoist.env`
   - confirm dashboard, tasks, rewards, and settings routes render
   - confirm notification acknowledgement updates the dashboard without uncaught errors

## Completion Step

Only after the contract tests, static checks, and browser smoke pass:

- update Milestone 12 from `[ ]` to `[x]` in `docs/Implementation-Plan.md`
- optionally mark the plan `todos` as completed if you want the artifact to reflect execution state