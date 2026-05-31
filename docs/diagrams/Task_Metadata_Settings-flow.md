# Task Metadata Settings Flow — Diagram

Source file for task and subtask metadata editing flows.

## Context

Parent Todoist tasks are **collapsible groups** in the UI. Subtasks are the only scoring/actionable items. The two modals have separate endpoints and accept different fields.

---

## Parent Task Settings Modal Flow

```mermaid
sequenceDiagram
    participant U as User
    participant UI as Tasks Page (tasks.vue)
    participant API as PATCH /api/tasks/:taskId/metadata
    participant DB as Database

    U->>UI: Click "Edit" on a parent task row
    UI->>API: GET /api/tasks/:taskId (load detail for modal preview)
    API-->>UI: EnrichedTaskDetail {title, metadata, subtasks[]}
    UI->>U: Show TaskGroupMetadata form (badge, completionBonusPoints)

    U->>UI: Update badge and/or completion bonus points
    U->>UI: Click "Save metadata"
    UI->>API: PATCH /api/tasks/:taskId/metadata {badge, completionBonusPoints}
    API->>DB: Upsert task_metadata (badge, completion_bonus_points)
    DB-->>API: Updated record
    API-->>UI: {data: {taskId, metadata}}
    UI->>UI: Invalidate inline-expanded detail cache
    UI->>UI: Reload list (refresh parent estimated points)
    UI->>U: Modal closes, list updated
```

---

## Subtask Settings Modal Flow

```mermaid
sequenceDiagram
    participant U as User
    participant UI as Tasks Page (tasks.vue)
    participant DAPI as GET /api/tasks/:taskId
    participant SAPI as PATCH /api/tasks/:taskId/subtasks/:subtaskId/metadata
    participant DB as Database

    U->>UI: Click expand (chevron) on a parent task row
    UI->>DAPI: GET /api/tasks/:taskId (lazy load)
    DAPI-->>UI: EnrichedTaskDetail {subtasks: [{id, title, metadata, estimatedPoints}]}
    UI->>U: Show subtask rows inline beneath parent

    U->>UI: Click "Edit" on a subtask row
    UI->>U: Show SubtaskMetadata form (priority, difficulty, timeEstimateMinutes)
    note over UI,U: Shows current estimatedPoints as preview

    U->>UI: Update priority / difficulty / time estimate
    U->>UI: Click "Save subtask settings"
    UI->>SAPI: PATCH /api/tasks/:id/subtasks/:subtaskId/metadata {priority, difficulty, timeEstimateMinutes}
    SAPI->>DB: Validate subtask belongs to parent
    SAPI->>DB: Upsert task_metadata (priority, difficulty, time_estimate_minutes)
    DB-->>SAPI: Updated record
    SAPI-->>UI: {data: {subtaskId, metadata}}
    UI->>UI: Invalidate parent detail cache
    UI->>UI: Reload detail (fresh per-subtask estimated points)
    UI->>UI: Reload list (fresh parent total estimated points)
    UI->>U: Modal closes, subtask rows updated
```

---

## Field Reference

| Field | Scope | Endpoint | Type |
|-------|-------|----------|------|
| `badge` | Parent task | PATCH `.../metadata` | `string \| null`, max 64 chars |
| `completionBonusPoints` | Parent task | PATCH `.../metadata` | non-negative integer |
| `priority` | Subtask | PATCH `.../subtasks/:id/metadata` | `"low" \| "medium" \| "high"` |
| `difficulty` | Subtask | PATCH `.../subtasks/:id/metadata` | integer 1–10 |
| `timeEstimateMinutes` | Subtask | PATCH `.../subtasks/:id/metadata` | positive integer or null |
