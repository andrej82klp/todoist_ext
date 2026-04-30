# Outstanding Implementation Plan — Todoist Companion MVP

This plan reflects the current implementation state as verified on 2026-04-30. It removes milestones that are already complete and keeps only the work that is still open or still needs verification.

How to use:
- Mark a milestone done by changing `[ ]` to `[x]`.
- Keep the checklist lines intact so a new agent can parse them reliably.
- If a milestone is partially complete, leave it unchecked and use the carryover notes to close the gap before moving on.

## Verified Baseline

Completed and verified:
- Milestone 1 — Project scaffold and base app shell
- Milestone 2 — Database foundation and migrations
- Milestone 3 — Shared types, API envelopes, and validation layer
- Milestone 4 — Session foundation and auth state endpoint
- Milestone 5 — Todoist OAuth login and profile fetch

Partially verified / still open:
- None.

## Outstanding Milestones

2. [x] Milestone 6 — Initial Todoist sync and local mapping
   - Implement Todoist read-only sync for projects, tasks, and subtasks.
   - Persist user-scoped mappings without duplicates.
   - Store the minimal cached Todoist fields required by the original plan.
   - Add `initialSyncCompleted` readiness to the session response.
   - Add `todoistSyncService.runInitialSync(userId)`.
   - Acceptance:
     - post-OAuth sync imports projects, tasks, and subtasks.
     - rerunning sync is idempotent.
     - session reports sync readiness.

3. [x] Milestone 7 — Task list API and task metadata API
   - Implement `GET /api/tasks`.
   - Implement `GET /api/tasks/:taskId`.
   - Implement `PATCH /api/tasks/:taskId/metadata`.
   - Implement `PATCH /api/tasks/metadata/batch`.
   - Add sorting by priority, difficulty, estimated points, and deadline.
   - Add filtering by project and completed state.
   - Implement progress calculation for tasks with subtasks only.
   - Implement estimated-points calculation using current settings.
   - Acceptance:
     - paginated enriched task list works.
     - task details include subtasks.
     - metadata updates validate and persist.

4. [ ] Milestone 8 — Settings API and settings page
   - Implement `GET /api/settings`.
   - Implement `PATCH /api/settings`.
   - Build the settings page against the documented MVP settings surface.
   - Keep settings forward-looking only; do not recalculate historical ledger rows.
   - Acceptance:
     - settings load and save.
     - invalid settings return `422`.
     - new settings affect future calculations only.

5. [ ] Milestone 9 — Points engine and ledger foundation
   - Implement subtask point calculation.
   - Implement task completion bonus calculation.
   - Implement ledger transaction creation.
   - Implement transactional balance application.
   - Implement `GET /api/ledger`.
   - Implement `POST /api/ledger/adjustments`.
   - Require non-zero manual adjustments with a documented reason.
   - Acceptance:
     - every balance change creates a ledger row.
     - balance updates transactionally.
     - manual adjustments validate correctly.

6. [ ] Milestone 10 — Reward catalog API and reward shop page
   - Implement rewards CRUD endpoints and redemptions history endpoint.
   - Build the reward shop page.
   - Return affordability and missing-point information from the API.
   - Archive rewards instead of hard-deleting when history exists.
   - Acceptance:
     - rewards can be created, edited, and archived.
     - reward list includes affordability.
     - UI disables redeem when affordability is false.

7. [ ] Milestone 11 — Reward redemption
   - Implement `POST /api/rewards/:rewardId/redeem`.
   - Check balance, insert redemption, create `spent` ledger transaction, and decrement balance in one DB transaction.
   - Return updated points summary.
   - Guard against inconsistent duplicate-click behavior.
   - Acceptance:
     - affordable rewards redeem cleanly.
     - insufficient balance returns `409 INSUFFICIENT_POINTS`.

8. [ ] Milestone 12 — Dashboard API and dashboard UI
   - Implement `GET /api/dashboard`.
   - Implement `POST /api/dashboard/notifications/:notificationId/acknowledge`.
   - Return points summary, streak summary, today’s tasks, recent transactions, reward progress, and notifications from one endpoint.
   - Build the dashboard cards and notification banner.
   - Acceptance:
     - dashboard loads from one endpoint.
     - empty states and notification acknowledgement work.

9. [ ] Milestone 13 — Webhook receiver and idempotent completion processing
   - Implement `POST /api/todoist/webhook`.
   - Verify webhook signature.
   - Deduplicate deliveries.
   - Resolve mappings and award points transactionally.
   - Apply task completion bonus once when all subtasks are complete.
   - Acceptance:
     - invalid signatures are rejected.
     - duplicate deliveries do not double-award points.

10. [ ] Milestone 14 — Streak engine
   - Implement `streakService.evaluateDay(userId, date)`.
   - Support completed-item and minimum-points rule types.
   - Track current streak, longest streak, and last qualified date.
   - Implement automatic streak protection and dashboard notification generation.
   - Implement milestone bonuses and duplicate-prevention rules.
   - Acceptance:
     - qualifying work advances streak.
     - protection is consumed once when appropriate.
     - bonuses are awarded once.

11. [ ] Milestone 15 — Nightly reconciliation job
   - Implement `POST /api/internal/reconcile`.
   - Restrict it to internal/admin/dev use.
   - Recover missed completions without duplicating already-awarded work.
   - Log reconciliation summaries.
   - Document scheduler setup.
   - Acceptance:
     - reconciliation is safe to rerun.
     - missing completions are recovered exactly once.

12. [ ] Milestone 16 — Analytics summary
   - Implement `GET /api/analytics/summary`.
   - Return most rewarding projects, current streak, longest streak, and milestones reached.
   - Add a lightweight analytics section to the dashboard or a dedicated summary area.
   - Acceptance:
     - analytics summary is correct and remains MVP-scoped.

13. [ ] Milestone 17 — Task list UI completion
   - Turn the tasks page into the usable planning view.
   - Surface title, project, priority, difficulty, estimated points, deadline, progress, and progress eligibility.
   - Add sorting controls, filters, metadata editing, and deadline highlighting.
   - Acceptance:
     - task browsing and metadata editing work end to end.

14. [ ] Milestone 18 — Hardening, security, and observability
   - Add structured logging for OAuth, sync, webhook, awards, redemptions, and reconciliation outcomes.
   - Redact secrets from logs.
   - Verify all write endpoints validate input and enforce user scoping.
   - Verify all balance-changing operations are transactional.
   - Add basic rate/abuse protection and a deployment checklist.
   - Acceptance:
     - invalid input is consistently rejected.
     - tokens never leak to the frontend.
     - webhook duplicates are observable.

15. [ ] Milestone 19 — End-to-end MVP validation
   - Validate the full user journey from OAuth through sync, metadata, earning points, streaks, rewards, dashboard, analytics, and reconciliation safety.
   - Acceptance:
     - the core loop works end to end.
     - repeated webhook or reconciliation processing does not create duplicate point awards.
     - the app remains read-only relative to Todoist.

## Recommended Next Steps

1. Close Milestone 5 verification first. Do not treat OAuth as done until the failing test path is reconciled.
2. Implement Milestone 6 immediately after that, because task APIs and all user-visible progress depend on sync and mappings.
3. Build the first full user-value loop in this order:
   - Milestone 7
   - Milestone 8
   - Milestone 9
   - Milestone 10
   - Milestone 11
   - Milestone 12
4. Leave webhook, streaks, reconciliation, and analytics for after the points and rewards loop is stable.

## Validation Snapshot

Verified during this review:
- `pnpm db:smoke` passed.
- `tests/server/milestone-3-contracts.test.ts` passed.
- `tests/server/milestone-4-session.test.ts` passed.
- `tests/server/milestone-5-oauth.test.ts` passed.
- Browser OAuth login verified against Todoist; `/api/auth/session` returned the authenticated Todoist profile without error.

Needs follow-up:
- Continue with Milestone 7 — Task list API and task metadata API.

## Milestone 7 Completion Notes

Completed on 2026-04-30:
- `shared/schemas/tasks.ts` — added `batchMetadataUpdateItemSchema` and `batchMetadataUpdateSchema`.
- `shared/schemas/common.ts` — fixed `includeCompleted` to use `.optional().default(false)` outside `z.preprocess` for Zod v4 compatibility.
- `shared/types/domain.ts` — added `TaskSubtaskSummary`, `EnrichedTask`, `EnrichedTaskDetail` types.
- `server/repositories/tasks.ts` — queries tasks + metadata (LEFT JOIN), subtask counts, project names, and upserts metadata.
- `server/services/tasks/pointsCalculator.ts` — `calculateEstimatedPoints`, `isDeadlineApproaching`, `getDefaultPointsSettings`, `settingsToPointsSettings`.
- `server/services/tasks/taskAssemblyService.ts` — assembles enriched task list and detail from raw rows + settings.
- `server/api/tasks/index.get.ts` — `GET /api/tasks` with sorting (priority, difficulty, estimatedPoints, deadline), filtering (projectId, includeCompleted), and pagination.
- `server/api/tasks/[taskId]/index.get.ts` — `GET /api/tasks/:taskId` with subtasks.
- `server/api/tasks/[taskId]/metadata.patch.ts` — `PATCH /api/tasks/:taskId/metadata`.
- `server/api/tasks/metadata/batch.patch.ts` — `PATCH /api/tasks/metadata/batch`.
- `tests/server/milestone-7-tasks.test.ts` — 17 tests all passing.
- Browser verified: 8 tasks returned for logged-in user, task detail with 2 subtasks, metadata PATCH working.

Needs follow-up:
- Continue with Milestone 8 — Settings API and settings page.

## Milestone 6 Completion Notes

Completed on 2026-04-30:
- `server/services/todoist/sync.ts` — Todoist API client for projects and tasks with cursor-based pagination.
- `server/repositories/item-mappings.ts` — `itemMappingsRepository` with `upsertMany`, `countByUserId`, `findByUserId`, `findByUserIdAndType`.
- `server/services/todoist/todoistSyncService.ts` — `todoistSyncService.runInitialSync(userId, accessToken)` orchestrates project and task fetching and persists idempotent mappings.
- `server/api/auth/todoist/callback.get.ts` — triggers sync as background task after OAuth.
- `server/utils/session.ts` — `buildAuthSessionState` now checks `itemMappingsRepository.countByUserId` and returns `initialSyncCompleted: true` when items exist.
- `server/repositories/oauth-accounts.ts` — added `getDecryptedAccessToken` helper.
- `tests/server/milestone-6-sync.test.ts` — 8 tests covering API client, pagination, idempotency, counts, and session readiness. All pass.
- Browser verified: 22 items synced (5 projects, 8 tasks, 9 subtasks) for the test user.

## Metadata

- Updated: 2026-04-30 (Milestones 6 and 7 complete)