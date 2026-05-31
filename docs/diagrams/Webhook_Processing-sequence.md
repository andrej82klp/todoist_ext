# Webhook Processing — Sequence Diagram

Source for `Webhook_Processing-sequence.png`.

## Mermaid

```mermaid
sequenceDiagram
    participant T as Todoist
    participant W as Webhook Handler<br/>(POST /api/todoist/webhook)
    participant DB as Database
    participant P as Points Engine
    participant S as Streak Engine

    T->>W: POST item:completed {event_id, item_id}
    W->>W: Verify HMAC signature
    W->>DB: Begin transaction
    W->>DB: Insert webhook_delivery (idempotency guard)
    alt Duplicate delivery
        DB-->>W: NULL (row already exists)
        W-->>T: 200 {received:true, duplicated:true}
    end

    W->>DB: Find item mapping by todoist_item_id
    alt No mapping found
        W->>DB: Update delivery status = ignored_missing_mapping
        W-->>T: 200 {received:true, processed:false}
    end

    W->>DB: Mark item as completed

    alt itemType == "subtask"
        note over W,P: Subtasks are the only point-earning items
        W->>DB: Load subtask metadata (priority, difficulty) via transaction
        W->>DB: Load user settings via transaction
        W->>P: calculateTaskPoints(subtaskMetadata, settings)
        P-->>W: subtaskPoints
        W->>DB: Insert ledger row (earned, idempotent)
        W->>DB: Update point balance

        alt parentTodoistItemId present
            W->>DB: Count completed/total subtasks for parent
            alt All subtasks complete
                W->>DB: Mark parent task complete
                W->>DB: Load parent task metadata (completionBonusPoints)
                alt completionBonusPoints > 0
                    note over W,DB: Bonus idempotency key: todoist_webhook:task_completion_bonus:{userId}:{parentId}
                    W->>DB: Insert ledger row (bonus, idempotent)
                    W->>DB: Update point balance
                end
            end
        end
    end

    W->>S: Upsert streak history (date, pointsDelta, completedCountDelta)
    W->>S: Evaluate streak for date (qualify, protect, milestone)
    S->>DB: Update streak state, history, protection, awards

    W->>DB: Update delivery status = processed
    W->>DB: Commit transaction
    W-->>T: 200 {received:true, processed:true}
```

## Notes

- Parent task `item:completed` events are still synced (marking the task complete locally) but do **not** award points.
- Only `itemType === 'subtask'` entries earn points and count toward streak completion rules.
- The completion bonus is a fixed integer per parent task (`completionBonusPoints`), not a percentage of subtask totals.
- All DB operations within the handler run in a single transaction with a 1-connection pool (postgres.js `max: 1`). Nested queries **must** reuse the transaction object to avoid deadlocks.
