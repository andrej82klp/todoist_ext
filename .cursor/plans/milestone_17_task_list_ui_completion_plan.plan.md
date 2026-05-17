---
name: Milestone 17 Task List UI Completion Plan
targetFile: /workspaces/todoist_ext/.cursor/plans/milestone_17_task_list_ui_completion_plan.plan.md
overview: Turn the placeholder tasks page into the primary planning surface by tightening the remaining task-list contract for project filtering, wiring route-synced filter and sort state to the existing task endpoints, adding an on-demand metadata editor with deadline and progress presentation, covering the flow with focused server and browser tests, and verifying the page end to end before marking the milestone complete.
todos:
  - id: confirm-contract
    content: Review milestone 17 requirements, the task API spec, the current placeholder tasks page, and the existing task routes to lock the UI scope and the minimum backend contract adjustments needed for project filtering
    status: pending
  - id: fix-project-filter-contract
    content: Make the task list response expose a stable project filter identifier and project filter options that match `GET /api/tasks?projectId=...`, then update shared types, docs, and server tests
    status: pending
  - id: build-task-page-state
    content: Replace the tasks placeholder with a route-synced planning page that fetches `GET /api/tasks`, handles loading and empty states, and keeps filters, sort order, and pagination in URL state
    status: pending
  - id: build-task-list-ui
    content: Implement the responsive task list presentation for title, project, priority, difficulty, estimated points, deadline, progress, and progress eligibility with clear deadline highlighting
    status: pending
  - id: add-metadata-editor
    content: Add a task metadata edit flow using `GET /api/tasks/:taskId` and `PATCH /api/tasks/:taskId/metadata`, with validation feedback, refresh behavior, and saved-state persistence
    status: pending
  - id: add-ui-tests
    content: Add focused task-page browser coverage and extend existing server task tests for any contract changes introduced to support the UI
    status: pending
  - id: verify-locally
    content: Run lint, typecheck, targeted server tests, targeted browser tests, and a manual `/tasks` verification pass across desktop and mobile layouts
    status: pending
  - id: mark-complete
    content: Mark milestone 17 complete in docs/Implementation-Plan.md after the tasks page meets the browsing and metadata-editing acceptance criteria end to end
    status: pending
isProject: false
---

# Milestone 17 — Task List UI Completion

## Context and Current State

Milestone 7 delivered the backend task list and metadata APIs, but the actual tasks page is still only a placeholder. Milestone 17 is the missing UI layer that turns those APIs into the daily planning surface.

What already exists:

| Asset | File | Notes |
|---|---|---|
| Tasks page route | `app/pages/tasks.vue` | Exists, but currently renders only `AppPagePlaceholder` |
| Task list route | `server/api/tasks/index.get.ts` | Supports `projectId`, `sortBy`, `sortOrder`, `includeCompleted`, `page`, and `pageSize` |
| Task detail route | `server/api/tasks/[taskId]/index.get.ts` | Returns one enriched task plus subtasks |
| Task metadata write route | `server/api/tasks/[taskId]/metadata.patch.ts` | Accepts the full metadata payload and persists it |
| Batch metadata route | `server/api/tasks/metadata/batch.patch.ts` | Exists, but is optional for this milestone unless the UI genuinely needs multi-edit save |
| Task assembly logic | `server/services/tasks/taskAssemblyService.ts` | Computes estimated points, progress, project name, and deadline-approaching flags |
| Shared task DTOs | `shared/types/domain.ts` | Defines `EnrichedTask`, `EnrichedTaskDetail`, and `TodoistTaskMetadata` |
| Query validation | `shared/schemas/common.ts`, `shared/schemas/tasks.ts` | Defines the task list query schema and metadata validation rules |
| Existing server coverage | `tests/server/milestone-7-tasks.test.ts` | Covers auth, list filtering, sorting helpers, task detail, and metadata persistence |
| Existing page pattern | `app/pages/rewards.vue` | Good reference for authenticated `useFetch`, save states, and error handling patterns |

What is still missing:

- A real planning UI on `/tasks`
- A stable response contract for building project filter options from the list API
- Route-synced filter, sort, and pagination state
- A metadata editing UI that uses the existing task detail and patch endpoints
- Focused browser coverage for the new page behavior
- Manual verification guidance for responsiveness and end-to-end UX

## Scope Decisions

### 1. Treat this as a frontend-first milestone with one small contract fix

Most Milestone 17 work belongs in the Nuxt page layer, not in new repositories or services. The existing task backend already provides the core data and write paths.

The one backend issue that should be addressed before building the filter UI is the project filter identifier mismatch:

- `GET /api/tasks?projectId=...` currently filters by Todoist project id
- the assembled task response currently exposes `projectId` from the local mapping row, not the Todoist project id

That is a real usability problem for the page because the UI cannot reliably round-trip a selected project filter from the API response back into the query parameter.

Recommended fix:

- make the list response expose the same project identifier that the query expects
- add a compact list of available projects to the list response metadata so the filter dropdown is not dependent on the current paginated slice

Recommended shape:

```ts
interface TaskListProjectOption {
  id: string
  name: string
}

interface TaskListMeta {
  page: number
  pageSize: number
  total: number
  availableProjects: TaskListProjectOption[]
}
```

If implementation proves that changing `EnrichedTask.projectId` would ripple too widely, add a new field such as `projectTodoistId` and use that consistently for filtering instead. Do not leave the current mismatch in place.

### 2. Prefer a single-task edit flow over batch editing

The batch metadata endpoint exists, but Milestone 17 does not require spreadsheet-style editing. The smallest complete slice is:

- browse tasks in a list
- open one task editor
- save the full metadata payload for that task
- refresh the task row from server truth

That aligns with the current single-task patch contract and avoids inventing draft-state complexity too early.

Use the batch route only if, during implementation, the UX naturally evolves into multi-row editing and the added complexity remains justified.

### 3. Keep filtering and sorting MVP-scoped to the documented query params

Do not expand this milestone into free-text search, saved views, or project management. The page only needs:

- project filter
- include-completed toggle
- sort field
- sort direction
- pagination

That matches the current API contract and the milestone acceptance criteria.

### 4. Trust server-derived task state instead of re-deriving it in the browser

The server already computes:

- `estimatedPoints`
- `progressPercent`
- `eligibleForProgressTracking`
- `isDeadlineApproaching`

The page should display these values directly instead of recomputing them client-side. That keeps the UI aligned with future settings changes and avoids duplicated business logic in the page.

### 5. Preserve the Todoist read-only boundary

The tasks page should only update app-owned metadata. It must not create, complete, reorder, or otherwise mutate Todoist tasks from this milestone.

## Backend and Contract Work

### 1. Tighten the task list response contract

Modify the list API only as much as needed to make the UI viable.

Recommended files:

- `shared/types/domain.ts`
- `server/services/tasks/taskAssemblyService.ts`
- `server/api/tasks/index.get.ts`
- `docs/API-endpoint-specification.md`
- `tests/server/milestone-7-tasks.test.ts`

Recommended changes:

- expose a stable project filter id in each task row
- derive `meta.availableProjects` from the full filtered result set before pagination slicing
- keep `availableProjects` sorted alphabetically by name for stable UI ordering
- document the updated response shape in the API spec
- extend the server task tests to cover the chosen contract explicitly

Why this matters:

- the page needs a source of truth for the project filter dropdown
- the selected filter value must map back to a valid `projectId` query parameter
- filter options should not disappear just because the current page slice does not include a project

### 2. Preserve current route behavior unless the UI proves a gap

Do not add new task endpoints unless the current routes demonstrably block the page. The intended API surface for this milestone remains:

- `GET /api/tasks`
- `GET /api/tasks/:taskId`
- `PATCH /api/tasks/:taskId/metadata`

Keep the backend change surface narrow and directly tied to the tasks page.

## Frontend Implementation Plan

### 1. Replace the placeholder page with route-synced page state

Update `app/pages/tasks.vue` to become the real planning page.

Recommended state model:

- initialize `projectId`, `sortBy`, `sortOrder`, `includeCompleted`, and `page` from the route query
- keep those values synced back into the URL so the view is refresh-safe and shareable
- reset `page` to `1` when filter or sort state changes
- keep `pageSize` fixed at a practical UI value unless there is a concrete reason to expose it

Recommended data flow:

```ts
const query = computed(() => ({
  projectId: selectedProjectId.value || undefined,
  sortBy: selectedSortBy.value || undefined,
  sortOrder: selectedSortOrder.value,
  includeCompleted: includeCompleted.value,
  page: currentPage.value,
  pageSize: 20
}))

const { data, pending, error, refresh } = await useFetch('/api/tasks', {
  credentials: 'include',
  query
})
```

Behavior requirements:

- show a skeleton state while fetching
- show a recoverable error state when the request fails
- show a meaningful empty state when there are no synced tasks
- preserve the current filter and sort state after a successful metadata save

### 2. Build a responsive planning layout

The tasks page should work as a data-dense planning view on desktop and still remain usable on smaller screens.

Recommended component split if the page grows beyond a manageable size:

- `app/components/tasks/TaskListToolbar.vue`
- `app/components/tasks/TaskListTable.vue`
- `app/components/tasks/TaskMetadataSlideover.vue`

If the page stays readable as one file, keeping it in `app/pages/tasks.vue` is acceptable. Do not extract components just for ceremony.

Recommended desktop presentation:

- toolbar row for filters and sort controls
- task table or structured list with one row per task
- explicit edit action per row

Recommended mobile presentation:

- stacked task cards using the same data fields
- filters remaining at the top of the page
- edit action still available without horizontal overflow

Required task fields to surface visibly:

- title
- project name
- metadata priority
- metadata difficulty
- estimated points
- deadline
- progress percent when present
- progress eligibility when subtasks do not exist

Recommended visual treatment:

- use a warning or error accent when `isDeadlineApproaching` is true
- use a neutral “No subtasks” or equivalent badge when `eligibleForProgressTracking` is false
- use compact badges or chips for priority and project name
- keep estimated points visually prominent because it is the core planning signal for the app

### 3. Add a task detail and metadata editing flow

Use the task detail route to support a focused edit experience instead of embedding every form control directly into the list rows.

Recommended interaction:

- clicking “Edit” opens a modal or slideover
- the page fetches `GET /api/tasks/:taskId` on demand when the editor opens
- the editor shows the current task summary and subtasks for context
- saving sends the full metadata payload to `PATCH /api/tasks/:taskId/metadata`
- after save, close the editor and refresh the list request

Recommended fields in the editor:

- priority
- difficulty
- time estimate minutes
- completion bonus enabled
- completion bonus percent
- badge
- custom point override

Important implementation details:

- send the full metadata object, not a partial payload, because the current route parses the full schema
- disable the save action while the patch request is in flight
- surface server validation messages when present
- preserve the current list state and scroll position after save where practical
- show subtasks and progress as read-only context, not editable Todoist content

### 4. Refresh the list from server truth after each successful save

Do not manually patch local task rows with guessed derived values. A metadata change can affect:

- estimated points
- sorting order
- visible row content

The reliable path is:

- patch the task metadata
- call `refresh()` on the list fetch
- if the edited task is still selected, optionally re-open or refresh detail data from the detail route

## Recommended File Changes

### 1. `shared/types/domain.ts`

Update the task list types to represent the final filterable project identifier and any added list metadata shape.

Possible additions:

- `TaskListProjectOption`
- `TaskListMeta`
- `projectTodoistId` on `EnrichedTask` if that is the least disruptive contract fix

### 2. `server/services/tasks/taskAssemblyService.ts`

Update the assembled task DTO to expose the correct project identifier for filtering.

### 3. `server/api/tasks/index.get.ts`

Derive and return `availableProjects` from the full filtered list before applying pagination, and keep sort behavior unchanged unless a concrete UI issue appears.

### 4. `docs/API-endpoint-specification.md`

Revise the `GET /api/tasks` response section so the UI contract matches the actual implementation used by Milestone 17.

### 5. `tests/server/milestone-7-tasks.test.ts`

Extend the existing task API coverage rather than creating a redundant new server test file.

Recommended additions:

- project filter option metadata is returned consistently
- the project identifier in the response matches the query parameter expectation
- sorting still behaves correctly after the contract update
- metadata edits remain user-scoped and persist correctly

### 6. `app/pages/tasks.vue`

Replace the placeholder with the full page implementation.

### 7. Optional extracted UI files

If the page becomes too large, add:

- `app/components/tasks/TaskListToolbar.vue`
- `app/components/tasks/TaskListTable.vue`
- `app/components/tasks/TaskMetadataSlideover.vue`

### 8. Browser test coverage

Add a focused Playwright spec for the tasks page.

Recommended location:

- `playwright/tasks-page.spec.ts`

If a committed Playwright config or established spec directory appears during implementation, keep the new test consistent with that location instead of forcing this exact path.

## Verification Plan

### 1. Server contract verification

Run and pass the task server tests after the contract and page work is complete.

Recommended command:

```bash
pnpm vitest run tests/server/milestone-7-tasks.test.ts
```

What to verify in those tests:

- unauthenticated access still returns `401`
- project filtering uses the same id shape returned to the UI
- `includeCompleted` behavior still works
- sort fields still produce the documented order
- metadata writes remain scoped to the current user
- the updated list response metadata remains stable

### 2. Type and lint verification

Run the repo-wide checks that are already standard for this project.

Recommended commands:

```bash
pnpm lint
pnpm typecheck
```

### 3. Browser verification

Add and run a targeted Playwright spec for the tasks page.

Recommended scenarios:

- authenticated user can load `/tasks`
- project filter options render from server response and apply the correct query value
- changing sort field and direction updates the rendered order
- include-completed toggle updates the visible list
- opening a task editor loads task details
- saving metadata updates the row after refresh
- deadline approaching styling appears only when `isDeadlineApproaching` is true
- progress and non-eligible states render correctly
- empty state renders when the list is empty
- page remains usable on a mobile-sized viewport and a desktop-sized viewport

Recommended command once the spec exists:

```bash
pnpm test:e2e --grep "Tasks"
```

If the repo still lacks committed Playwright config at implementation time, add the minimum config necessary for this spec and document the chosen invocation in the PR or milestone notes.

### 4. Manual verification

Run one manual pass in the browser after automated checks succeed.

Manual checklist:

- visit `/tasks` while authenticated
- confirm the initial list loads without placeholder content
- change each filter and sort control and confirm the URL updates
- reload the page and confirm the selected view persists
- open a task with subtasks and confirm progress is displayed
- open a task without subtasks and confirm the non-eligible state is clear
- edit metadata for one task and confirm the row updates after save
- navigate between pages and confirm the list remains stable
- confirm deadline highlighting is visible only for approaching deadlines
- confirm the layout remains readable at narrow mobile width and standard desktop width

## Acceptance Checklist

Milestone 17 should be considered complete only when all of the following are true:

- `/tasks` is a real planning page rather than a placeholder
- users can browse tasks with the required fields visible
- users can filter by project and completed state
- users can sort by the documented sort fields
- users can open and save metadata edits end to end
- deadline highlighting is visible and correct
- progress and progress eligibility states are visible and understandable
- server tests, lint, typecheck, and task-page browser tests all pass
- manual verification confirms the page works on both desktop and mobile widths

## Final Step

After all verification passes, update `docs/Implementation-Plan.md` to mark Milestone 17 complete and add a link to this plan file in the milestone entry so future work references the implementation record directly.