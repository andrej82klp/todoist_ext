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
- Milestones 6–8 — Initial Todoist sync, task list/metadata API, and settings API + page (all `[x]` in the checklist below).
- Milestone 9 — Points engine and ledger foundation
- Milestone 10 — Reward catalog API and reward shop page

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

4. [x] Milestone 8 — Settings API and settings page
   - Implement `GET /api/settings`.
   - Implement `PATCH /api/settings`.
   - Build the settings page against the documented MVP settings surface.
   - Keep settings forward-looking only; do not recalculate historical ledger rows.
   - Acceptance:
     - settings load and save.
     - invalid settings return `422`.
     - new settings affect future calculations only.

5. [x] Milestone 9 — Points engine and ledger foundation
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

6. [x] Milestone 10 — Reward catalog API and reward shop page
   - Implement rewards CRUD endpoints and redemptions history endpoint.
   - Build the reward shop page.
   - Return affordability and missing-point information from the API.
   - Archive rewards instead of hard-deleting when history exists.
   - Acceptance:
     - rewards can be created, edited, and archived.
     - reward list includes affordability.
     - UI disables redeem when affordability is false.

7. [x] Milestone 11 — Reward redemption
   - Detailed execution plan: [Milestone 11 reward redemption plan](../.cursor/plans/milestone_11_redemption_plan.plan.md).
   - Implement `POST /api/rewards/:rewardId/redeem`.
   - Check balance, insert redemption, create `spent` ledger transaction, and decrement balance in one DB transaction.
   - Return updated points summary.
   - Guard against inconsistent duplicate-click behavior.
   - Acceptance:
     - affordable rewards redeem cleanly.
     - insufficient balance returns `409 INSUFFICIENT_POINTS`.
     - repeated clicks or retried requests do not create duplicate spends.

8. [x] Milestone 12 — Dashboard API and dashboard UI
   - Implement `GET /api/dashboard`.
   - Implement `POST /api/dashboard/notifications/:notificationId/acknowledge`.
   - Return points summary, streak summary, today’s tasks, recent transactions, reward progress, and notifications from one endpoint.
   - Build the dashboard cards and notification banner.
   - Acceptance:
     - dashboard loads from one endpoint.
     - empty states and notification acknowledgement work.

9. [x] Milestone 13 — Webhook receiver and idempotent completion processing
   - Implement `POST /api/todoist/webhook`.
   - Verify webhook signature.
   - Deduplicate deliveries.
   - Resolve mappings and award points transactionally.
   - Apply task completion bonus once when all subtasks are complete.
   - Acceptance:
     - invalid signatures are rejected.
     - duplicate deliveries do not double-award points.

10. [x] Milestone 14 — Streak engine
   - Implement `streakService.evaluateDay(userId, date)`.
   - Support completed-item and minimum-points rule types.
   - Track current streak, longest streak, and last qualified date.
   - Implement automatic streak protection and dashboard notification generation.
   - Implement milestone bonuses and duplicate-prevention rules.
   - Acceptance:
     - qualifying work advances streak.
     - protection is consumed once when appropriate.
     - bonuses are awarded once.

11. [skip] Milestone 15 — Nightly reconciliation job
   - Implement `POST /api/internal/reconcile`.
   - Restrict it to internal/admin/dev use.
   - Recover missed completions without duplicating already-awarded work.
   - Log reconciliation summaries.
   - Document scheduler setup.
   - Acceptance:
     - reconciliation is safe to rerun.
     - missing completions are recovered exactly once.

12. [x] Milestone 16 — Analytics summary
   - Implemented `GET /api/analytics/summary`.
   - Returns most rewarding projects (top 5, earned points only), current streak, longest streak, and milestones reached.
   - Added analytics section with two cards to the dashboard home page.
   - Detailed execution plan: [Milestone 16 analytics summary plan](../.cursor/plans/milestone_16_analytics_summary_plan.plan.md).
   - Acceptance:
     - analytics summary is correct and remains MVP-scoped.

13. [x] Milestone 17 — Task list UI completion
   - Detailed execution plan: [Milestone 17 task list UI completion plan](../.cursor/plans/milestone_17_task_list_ui_completion_plan.plan.md).
   - Turn the tasks page into the usable planning view.
   - Surface title, project, priority, difficulty, estimated points, deadline, progress, and progress eligibility.
   - Add sorting controls, filters, metadata editing, and deadline highlighting.
   - Acceptance:
     - task browsing and metadata editing work end to end.

14. [x] Milestone 18 — Hardening, security, and observability
   - Detailed execution plan: [Milestone 18 hardening, security, and observability plan](../.cursor/plans/milestone_18_hardening_security_observability_plan.plan.md).
   - Added structured logging (`server/utils/logger.ts`) with automatic redaction of tokens, cookies, secrets, OAuth codes, and HMAC headers.
   - Added in-process rate limiting (`server/utils/rate-limit.ts`) applied to webhook, OAuth callback, redemption, ledger adjustments, and metadata write routes.
   - Replaced ad hoc `console.error` calls in OAuth service and callback with structured `logger.error`/`logger.info` events.
   - Instrumented Todoist sync, webhook processing, and reward redemption with structured outcome events.
   - Added `tooManyRequestsError` helper and `TOO_MANY_REQUESTS` (429) to shared error constants.
   - All write routes verified for auth (`requireCurrentUser`), schema validation, and owner scoping.
   - All balance-changing operations confirmed transactional (unchanged from prior milestones).
   - Created `tests/server/milestone-18-hardening.test.ts` covering auth guards, validation, cross-user scoping, session secrecy, rate limiter unit tests, and logger redaction unit tests.
   - Created `docs/DEPLOYMENT.md` with deployment checklist, secret generation guidance, and operations reference.
   - Acceptance:
     - invalid input is consistently rejected.
     - tokens never leak to the frontend.
     - webhook duplicates are observable.

15. [x] Milestone 20 — Grouped subtask task list and item-specific metadata
   - Detailed execution plan: [Milestone 20 grouped subtask task list plan](../.cursor/plans/plan-groupedSubtaskTaskList.prompt.md).
   - Restructured task experience so parent Todoist tasks are collapsible groups and subtasks are the sole scoring/actionable items.
   - Replaced `TodoistTaskMetadata` with `TaskGroupMetadata` (badge, fixed completion bonus points) and `SubtaskMetadata` (priority, difficulty, time estimate).
   - Added `completion_bonus_points` column to `task_metadata` table; removed deprecated percentage bonus fields.
   - Added `PATCH /api/tasks/:taskId/subtasks/:subtaskId/metadata` route for per-subtask scoring metadata.
   - Updated webhook to award points only for subtask completions; parent bonus is a fixed integer, not a percentage.
   - Rebuilt tasks page with expand/collapse grouped rows, lazy subtask detail loading, and subtask settings modal.
   - Updated dashboard, analytics, and settings surfaces to drop parent priority/difficulty.
   - Acceptance:
     - subtasks are the only point-earning items.
     - parent bonus is a configurable fixed integer per task.
     - tasks page shows collapsible parent groups with inline subtask rows.
     - all contract and integration tests pass.

16. [ ] Milestone 19 — End-to-end MVP validation
   - Validate the full user journey from OAuth through sync, metadata, earning points, streaks, rewards, dashboard, analytics, and reconciliation safety.
   - Acceptance:
     - the core loop works end to end.
     - repeated webhook or reconciliation processing does not create duplicate point awards.
     - the app remains read-only relative to Todoist.

## Recommended Next Steps

1. Build the first full user-value loop in this order:
   - Milestone 8
   - Milestone 9
   - Milestone 10
   - Milestone 11
   - Milestone 12
4. Leave webhook, streaks, reconciliation, and analytics for after the points and rewards loop is stable.