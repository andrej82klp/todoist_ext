## Plan: Grouped Subtask Task List

TL;DR: Restructure the task experience so parent Todoist tasks are collapsible groups and subtasks are the only scoring/actionable items. Keep Todoist as source of truth, keep the existing mapping table, update metadata contracts to be item-type-specific, calculate parent totals from subtask points plus a fixed parent bonus, and update API, UI, docs, diagrams, and tests together so no surface shows the old “parent task is actionable” model.

**Recommended product decisions**
- Parent task completion bonus should be a fixed integer point amount (`completionBonusPoints`), not the current percentage-based `completionBonusPercent`, because the requested modal says “Bonus points” and parent totals should be directly understandable.
- Subtask reward points should continue to be calculated from subtask priority + difficulty using the existing global point multipliers; estimated time remains descriptive metadata. The modal should show the computed reward point preview, but only allow editing priority, difficulty, and estimated time.
- Parent tasks should not expose priority, difficulty, time estimate, or custom point override in the UI. Parent modal only edits badge and completion bonus points.
- Initial `/tasks` load should fetch only parent groups. Subtasks should be lazy-loaded by expanding a parent through `GET /api/tasks/:taskId`, then cached client-side until metadata changes.
- Keep the app read-only relative to Todoist. “Actionable” means actionable for app scoring/settings, not completing Todoist items inside this app.

**Steps**

1. **Define the new shared contracts**
   - [ ] Replace the single `TodoistTaskMetadata` usage with role-specific types: `TaskGroupMetadata` for parent task badge/bonus, and `SubtaskMetadata` for subtask priority/difficulty/time estimate.
   - [ ] Update `EnrichedTask` so it represents a parent group: `metadata: TaskGroupMetadata`, `subtaskPointsTotal`, `completionBonusPoints`, and `totalRewardPoints` or keep `estimatedPoints` as the total if minimizing API churn.
   - [ ] Update `TaskSubtaskSummary` to include `metadata: SubtaskMetadata`, `estimatedPoints` or `rewardPoints`, `isCompleted`, and the existing IDs/title.
   - [ ] Update `DashboardTaskSummary` so dashboard cards no longer require parent priority/difficulty; use deadline, progress, badge, total reward points, and title.
   - [ ] Update `TASK_SORT_FIELDS` to remove parent-only `priority` and `difficulty`; use fields like `task`, `estimatedPoints`/`totalRewardPoints`, `deadline`, and optionally `progress`.

2. **Update validation schemas**
   - [ ] Replace the current all-purpose `taskMetadataSchema` with `taskGroupMetadataSchema` and `subtaskMetadataSchema`.
   - [ ] Parent schema accepts `badge: string | null` and `completionBonusPoints: nonnegative integer`.
   - [ ] Subtask schema accepts `priority`, `difficulty`, and `timeEstimateMinutes`; keep `customPointOverride` out of the new UI contract unless direct point entry is explicitly wanted later.
   - [ ] Update batch schema only if batch metadata editing remains in scope; otherwise remove or deprecate parent-task batch editing tests/docs.
   - [ ] Keep API error envelopes unchanged through `defineApiHandler` and `parseBodyWithSchema`.

3. **Make the DB schema represent fixed task bonuses**
   - [ ] Update `server/db/schema.ts` `taskMetadata` table: add `completionBonusPoints integer not null default 0` with a nonnegative check.
   - [ ] Remove or fully deprecate `completionBonusEnabled` and `completionBonusPercent` from active code; because current data is disposable, prefer dropping them in the new migration to avoid mixed semantics.
   - [ ] Remove or deprecate `globalSettings.completionBonusPercent` if parent bonuses are fully per-task; update settings types/UI accordingly.
   - [ ] Generate a deterministic Drizzle migration under `drizzle/` and ensure snapshots/journal align.
   - [ ] Keep `todoistItemMappings.itemType` and `parentTodoistItemId` unchanged; they already support parent/subtask grouping.

4. **Refactor task repository access**
   - [ ] Add a repository helper that loads any Todoist mapping by internal ID plus metadata and exposes `itemType` and `parentTodoistItemId`.
   - [ ] Keep `findTasksWithMeta` parent-only, but return parent metadata fields only.
   - [ ] Update `getSubtasksForTask` to left-join metadata so subtask rows include priority, difficulty, time estimate, and custom/default values needed for point calculation.
   - [ ] Add a bulk subtask summary helper for multiple parents so `buildEnrichedTaskList` can compute group totals without N+1 queries.
   - [ ] Add parent/subtask ownership checks for nested subtask metadata updates.

5. **Refactor task assembly and point calculations**
   - [ ] Add a mapper for parent metadata and a mapper for subtask metadata instead of `rowToMetadata` assuming one shape.
   - [ ] Compute each subtask’s reward points with `calculateEstimatedPoints(subtaskMetadata, settingsToPointsSettings(settings))`.
   - [ ] Compute parent `subtaskPointsTotal = sum(all child subtask points)`.
   - [ ] Compute parent total as `subtaskPointsTotal + completionBonusPoints` when bonus points are greater than zero.
   - [ ] Update progress calculations to remain based on completed subtasks / total subtasks.
   - [ ] Ensure tasks with exactly one subtask still render as a parent group with one actionable child.

6. **Update API endpoints**
   - [ ] `GET /api/tasks`: return parent groups only, sorted and paginated by the new parent/group fields.
   - [ ] `GET /api/tasks/:taskId`: return parent detail with enriched subtasks including per-subtask reward points and metadata.
   - [ ] `PATCH /api/tasks/:taskId/metadata`: validate the ID is a parent task and accept only badge + completion bonus points.
   - [ ] Add `PATCH /api/tasks/:taskId/subtasks/:subtaskId/metadata`: validate the subtask belongs to the parent task and accept priority + difficulty + time estimate.
   - [ ] Decide whether to keep `PATCH /api/tasks/metadata/batch`; if kept, make it subtask-only or item-type-aware and update docs/tests.
   - [ ] Update all responses through `success`/`collection`; do not introduce bare objects.

7. **Update webhook and point-award behavior**
   - [ ] Preserve local completion syncing for both parent tasks and subtasks.
   - [ ] Ensure only `mapping.itemType === 'subtask'` awards earned points and increments completed-item streak aggregates.
   - [ ] When all sibling subtasks are complete, mark the parent complete locally and award exactly one fixed parent bonus ledger transaction if `completionBonusPoints > 0`.
   - [ ] Remove the old parent-base percentage bonus calculation from the webhook path.
   - [ ] Keep idempotency key for parent bonus independent of delivery/event so duplicate subtask events cannot re-award the bonus.
   - [ ] Add tests proving a direct parent task completion event creates no earned points, no completion count, and no bonus unless the subtask completion path earned it.

8. **Update dashboard and analytics cross-surfaces**
   - [ ] Update dashboard “today tasks” to display parent group total reward points and progress, not parent priority/difficulty.
   - [ ] Update dashboard sorting to deadline first, then total reward points, then title.
   - [ ] Verify analytics still attributes `todoist_webhook_subtask_completion` to subtask projects and `todoist_webhook_task_completion_bonus` to parent task projects.
   - [ ] Update analytics tests only if fixed bonus metadata changes expected point totals.

9. **Rebuild the tasks page UI**
   - [ ] Replace the flat desktop table with parent group rows that include expand/collapse control, title, project, badge, subtask progress, subtask points total, bonus, and total reward points.
   - [ ] On first load, render only collapsed parent groups; no subtask rows should be visible.
   - [ ] Maintain `expandedTaskIds`, `detailsByTaskId`, and per-task pending/error state for lazy detail loading.
   - [ ] Expanded desktop view renders subtask rows beneath the parent with title, status, priority, difficulty, time estimate, reward points, and subtask settings action.
   - [ ] Mobile view mirrors the same group-first behavior using compact expandable sections.
   - [ ] Parent task action opens `TaskSettingsModal`; subtask action opens `SubtaskSettingsModal`.
   - [ ] Remove parent priority/difficulty columns and old single metadata modal.
   - [ ] After saving parent metadata, refresh the parent list row and cached detail if present; after saving subtask metadata, refresh cached detail and parent totals.

10. **Componentize where useful**
   - [ ] Keep route/query/page loading in `app/pages/tasks.vue`.
   - [ ] Extract modal components if the page becomes unwieldy: `TaskSettingsModal.vue` and `SubtaskSettingsModal.vue`.
   - [ ] Consider extracting a group row/list component only after the first working pass; avoid a broad refactor before behavior is stable.

11. **Update settings page if bonus defaults are removed**
   - [ ] Remove “Default completion bonus %” from the Points settings UI if the fixed bonus is solely parent-specific.
   - [ ] Update `GlobalSettingsPoints`, settings schemas, settings service mapping, and milestone/settings tests accordingly.
   - [ ] Keep priority multipliers and difficulty multiplier because subtask scoring still uses them.

12. **Update docs**
   - [ ] Update API spec task shared types, `GET /api/tasks`, `GET /api/tasks/:taskId`, parent metadata PATCH, and new subtask metadata PATCH.
   - [ ] Update PRD/Description points sections so points are earned by subtasks and parent completion bonus is fixed per parent task.
   - [ ] Update Technical Architecture Progress & Points Engine section to describe task groups and actionable subtasks.
   - [ ] Add a new milestone/checklist entry to Implementation Plan for “Grouped subtask task list and item-specific metadata”.
   - [ ] Document that Todoist parent task completion is synced but not point-awarding.

13. **Update diagrams**
   - [ ] Update the webhook processing diagram to show subtask completion -> subtask points -> all siblings complete? -> parent bonus.
   - [ ] Add or update a task metadata/settings flow diagram showing parent task modal versus subtask modal.
   - [ ] Because existing diagrams are PNG-only, add Mermaid or PlantUML source files beside generated PNGs to make future diagram changes reviewable.

14. **Update tests**
   - [ ] Update `tests/server/milestone-7-tasks.test.ts` for group totals, subtask reward points, parent metadata PATCH, subtask metadata PATCH, updated sort fields, and rejected invalid item-type updates.
   - [ ] Update `tests/server/milestone-13-webhook.test.ts` for fixed bonus points and direct parent completion no-op scoring.
   - [ ] Update `tests/server/milestone-14-streaks.test.ts` to ensure completed-item streak rules count only subtasks.
   - [ ] Update `tests/server/milestone-12-dashboard.test.ts` for grouped total reward fields and removed parent priority/difficulty.
   - [ ] Update `tests/server/milestone-8-settings.test.ts` if global completion bonus percent is removed.
   - [ ] Update `tests/e2e/tasks-page.e2e.ts` for initial collapsed state, expanding a group, subtask settings save, parent settings save, and mobile expandable groups.
   - [ ] Update `tests/server/milestone-3-contracts.test.ts` if shared constants or validation schema tests change.

15. **Validation sequence**
   - [ ] Run `pnpm lint`.
   - [ ] Run `pnpm typecheck`.
   - [ ] Run `pnpm db:smoke` after schema/repository changes, only against a disposable DB.
   - [ ] Run targeted server suites: `vitest run tests/server/milestone-7-tasks.test.ts tests/server/milestone-13-webhook.test.ts tests/server/milestone-14-streaks.test.ts tests/server/milestone-12-dashboard.test.ts tests/server/milestone-8-settings.test.ts tests/server/milestone-3-contracts.test.ts`.
   - [ ] Run `pnpm build` because shared types, app UI, and server contracts changed together.
   - [ ] Run `pnpm test:e2e` or at minimum `pnpm exec playwright test tests/e2e/tasks-page.e2e.ts` when Playwright dependencies and DB are available.

**Relevant files**
- `server/db/schema.ts` — update metadata/global settings columns and checks.
- `drizzle/` — add deterministic migration and snapshot updates.
- `shared/types/domain.ts` — split parent/subtask metadata and update task/dashboard DTOs.
- `shared/schemas/tasks.ts` — replace all-purpose metadata schema with parent/subtask schemas.
- `shared/schemas/settings.ts` — remove/update global completion bonus fields if fixed parent bonus replaces percentage default.
- `shared/constants/api.ts` — update task sort fields.
- `server/repositories/tasks.ts` — add item-type-aware metadata reads/writes and subtask metadata joins.
- `server/services/tasks/taskAssemblyService.ts` — compute subtask reward points and parent group totals.
- `server/services/tasks/pointsCalculator.ts` — keep subtask point formula; add helper names if clarity improves.
- `server/services/points/pointsEngineService.ts` — remove old percent completion bonus usage if no other callers remain.
- `server/services/todoist/webhookService.ts` — enforce subtask-only point awards and fixed parent bonus.
- `server/api/tasks/index.get.ts` — parent group list contract and sorting.
- `server/api/tasks/[taskId]/index.get.ts` — detail contract with enriched subtasks.
- `server/api/tasks/[taskId]/metadata.patch.ts` — parent-only metadata update.
- `server/api/tasks/[taskId]/subtasks/[subtaskId]/metadata.patch.ts` — new subtask metadata update.
- `server/api/tasks/metadata/batch.patch.ts` — update, deprecate, or remove old parent-oriented batch behavior.
- `server/services/dashboard/dashboardService.ts` — dashboard today task projection and sorting.
- `app/pages/tasks.vue` — group-first collapsed list, expand/collapse state, lazy detail loading, modal wiring.
- `app/pages/index.vue` — dashboard task card fields.
- `app/pages/settings.vue` — remove/update default completion bonus settings if schema changes.
- `docs/API-endpoint-specification.md`, `docs/Technical-Architecture.md`, `docs/PRD.md`, `docs/Description.md`, `docs/Implementation-Plan.md` — update product/API/architecture docs.
- `docs/diagrams/` — update webhook and metadata/settings diagrams, add source files.
- `tests/server/milestone-7-tasks.test.ts`, `tests/server/milestone-13-webhook.test.ts`, `tests/server/milestone-14-streaks.test.ts`, `tests/server/milestone-12-dashboard.test.ts`, `tests/server/milestone-8-settings.test.ts`, `tests/server/milestone-3-contracts.test.ts`, `tests/e2e/tasks-page.e2e.ts` — update coverage.

**Risks and mitigations**
- Mixed bonus semantics: remove/deprecate percentage fields in one focused migration and update docs/tests in the same PR.
- Hidden parent-action paths: add tests for direct parent Todoist completion and parent metadata route rejecting subtask IDs.
- N+1 detail/point calculation: add bulk subtask loading for parent totals in list assembly.
- Dashboard drift: update dashboard DTOs and tests in the same change as task DTOs.
- Stale expanded data after save: refresh both list and cached detail after parent/subtask metadata writes.
- Diagram maintainability: add text diagram sources beside PNGs.
- Existing Playwright failures under `test-results/`: treat task-page e2e as required for this change, but report any pre-existing environment failures separately.

**Scope boundaries**
- Included: UI structure, task/subtask metadata contracts, DB schema, task API, webhook scoring behavior, dashboard touchpoints, docs, diagrams, and tests.
- Excluded: creating/editing/completing Todoist items from this app; production data migration/backfill strategy beyond disposable test data; advanced bulk editing UX; unrelated reward/shop redesign.
