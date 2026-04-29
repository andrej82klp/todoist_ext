# API Endpoint Specification
## Todoist Gamification Companion App

---

## 1. Purpose

This document defines the **API contract** between the frontend and backend for the Todoist Gamification Companion App MVP.

It is intended to:

- provide a stable integration contract between Nuxt frontend pages/components and Nitro backend endpoints
- define request and response formats
- standardize validation, error handling, authentication, and idempotency
- reduce ambiguity during parallel implementation
- serve as the implementation reference for both frontend and backend teams

This specification covers only **application-owned APIs**. It does **not** document Todoist’s external API directly.

---

## 2. API Design Principles

### 2.1 General Principles

- All app APIs are exposed under the `/api` namespace.
- All responses use `application/json` unless otherwise stated.
- The frontend must treat this specification as the **source of truth** for request/response payloads.
- The backend must not return undocumented fields unless explicitly marked as optional/extendable.
- Todoist remains the source of truth for projects, tasks, and subtasks; app endpoints enrich Todoist data with app-owned metadata.

### 2.2 API Style

The API uses a pragmatic REST-style structure:

- `GET` for reads
- `POST` for creation and action-style commands
- `PATCH` for partial updates
- `DELETE` for deletions where needed

### 2.3 Envelope Strategy

To keep the frontend predictable, all successful responses should follow one of these patterns:

#### Single-resource response

```json
{
  "data": { ... }
}
```

#### Collection response

```json
{
  "data": [ ... ],
  "meta": {
    "page": 1,
    "pageSize": 20,
    "total": 100
  }
}
```

#### Action response

```json
{
  "data": {
    "success": true,
    "message": "..."
  }
}
```

### 2.4 Error Envelope

All errors must use the following shape:

```json
{
  "error": {
    "code": "STRING_CODE",
    "message": "Human readable message",
    "details": {}
  }
}
```

Example:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request payload",
    "details": {
      "field": "difficulty"
    }
  }
}
```

---

## 3. Authentication and Session Contract

### 3.1 Authentication Model

- The browser authenticates to the app via **app session cookie**.
- The frontend must never call Todoist directly with access tokens.
- Backend endpoints requiring login must reject unauthenticated requests with `401 Unauthorized`.

### 3.2 Authorization Rules

For MVP, the app is effectively single-user but designed in a multi-user-safe way.

All endpoints that operate on user-owned resources must resolve the current user from the session and scope all reads/writes to that user.

### 3.3 Common Auth Errors

#### 401 Unauthorized

```json
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Authentication required"
  }
}
```

#### 403 Forbidden

```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "You do not have access to this resource"
  }
}
```

---

## 4. Shared Data Types

These types are reused across endpoints.

---

### 4.1 PriorityLevel

```json
"low" | "medium" | "high"
```

### 4.2 StreakBonusStrategy

```json
"fixed" | "percentage"
```

### 4.3 LedgerTransactionType

```json
"earned" | "spent" | "bonus" | "adjusted"
```

### 4.4 RewardAffordability

```json
{
  "canRedeem": true,
  "missingPoints": 0
}
```

### 4.5 TodoistTaskMetadata

```json
{
  "priority": "medium",
  "difficulty": 5,
  "timeEstimateMinutes": 45,
  "completionBonusEnabled": true,
  "completionBonusPercent": 10,
  "badge": "Deep Work",
  "customPointOverride": null
}
```

### 4.6 PointsSummary

```json
{
  "currentBalance": 860,
  "lifetimeEarned": 1420,
  "lifetimeSpent": 560
}
```

### 4.7 StreakSummary

```json
{
  "current": 6,
  "longest": 14,
  "protectionBalance": 2,
  "ruleType": "points",
  "ruleValue": 20,
  "nextMilestone": {
    "days": 7,
    "remainingDays": 1
  }
}
```

### 4.8 Reward

```json
{
  "id": "rew_123",
  "name": "Cinema Night",
  "description": "One guilt-free movie night",
  "category": "entertainment",
  "costPoints": 250,
  "isArchived": false,
  "affordability": {
    "canRedeem": true,
    "missingPoints": 0
  },
  "createdAt": "2026-04-12T12:00:00Z",
  "updatedAt": "2026-04-12T12:00:00Z"
}
```

### 4.9 LedgerTransaction

```json
{
  "id": "txn_123",
  "type": "earned",
  "amount": 75,
  "description": "Completed subtask: Draft architecture",
  "source": "subtask_completion",
  "relatedEntityType": "subtask",
  "relatedEntityId": "task_abc_sub_1",
  "createdAt": "2026-04-12T12:00:00Z"
}
```

---

## 5. HTTP Status Code Contract

### Success Codes

- `200 OK` – successful read or action
- `201 Created` – successful resource creation
- `204 No Content` – successful deletion with no body

### Client Error Codes

- `400 Bad Request` – malformed request
- `401 Unauthorized` – missing/invalid session
- `403 Forbidden` – access denied
- `404 Not Found` – resource not found
- `409 Conflict` – duplicate or state conflict
- `422 Unprocessable Entity` – validation failed

### Server Error Codes

- `500 Internal Server Error` – unexpected backend error
- `503 Service Unavailable` – upstream dependency unavailable or maintenance mode

---

## 6. Endpoint Groups Overview

The MVP includes the following endpoint groups:

- `/api/auth/*`
- `/api/dashboard/*`
- `/api/tasks/*`
- `/api/rewards/*`
- `/api/settings/*`
- `/api/ledger/*`
- `/api/analytics/*`
- `/api/todoist/webhook`
- `/api/internal/reconcile`

---

# 7. Authentication Endpoints

## 7.1 Start OAuth Flow

### `GET /api/auth/todoist/start`

Redirects the user to Todoist OAuth authorization.

#### Request
No body.

#### Response
- `302 Redirect` to Todoist OAuth page

#### Frontend behavior
- Frontend should navigate the browser directly to this endpoint.

---

## 7.2 OAuth Callback

### `GET /api/auth/todoist/callback`

Handles Todoist redirect, exchanges code, persists account, creates session, triggers initial sync.

#### Query Parameters

- `code: string`
- `state: string`
- `error?: string`

#### Success Response
- usually `302 Redirect` to `/`

#### Error Response
- redirect to frontend error page, or return structured JSON if handled programmatically

---

## 7.3 Current Session

### `GET /api/auth/session`

Returns the currently authenticated user session and sync readiness.

#### Response

```json
{
  "data": {
    "isAuthenticated": true,
    "user": {
      "id": "usr_123",
      "todoistUserId": "td_456"
    },
    "initialSyncCompleted": true
  }
}
```

---

## 7.4 Logout

### `POST /api/auth/logout`

Clears the app session.

#### Response

```json
{
  "data": {
    "success": true,
    "message": "Logged out successfully"
  }
}
```

---

# 8. Dashboard Endpoints

## 8.1 Dashboard Summary

### `GET /api/dashboard`

Returns the data required by the main dashboard screen.

#### Response

```json
{
  "data": {
    "points": {
      "currentBalance": 860,
      "lifetimeEarned": 1420,
      "lifetimeSpent": 560
    },
    "streak": {
      "current": 6,
      "longest": 14,
      "protectionBalance": 2,
      "ruleType": "points",
      "ruleValue": 20,
      "nextMilestone": {
        "days": 7,
        "remainingDays": 1
      }
    },
    "todayTasks": [
      {
        "id": "task_1",
        "todoistTaskId": "987654321",
        "title": "Finish PRD",
        "deadline": "2026-04-12",
        "priority": "high",
        "difficulty": 7,
        "estimatedPoints": 105,
        "progressPercent": 50
      }
    ],
    "recentTransactions": [
      {
        "id": "txn_1",
        "type": "earned",
        "amount": 30,
        "description": "Completed subtask: Research",
        "source": "subtask_completion",
        "relatedEntityType": "subtask",
        "relatedEntityId": "sub_1",
        "createdAt": "2026-04-12T08:00:00Z"
      }
    ],
    "rewardProgress": {
      "closestReward": {
        "id": "rew_1",
        "name": "Cinema Night",
        "costPoints": 250,
        "pointsNeeded": 40
      }
    },
    "notifications": [
      {
        "id": "notif_1",
        "type": "streak_protection_used",
        "severity": "warning",
        "message": "Your streak was protected yesterday. 2 protection days remain.",
        "requiresAcknowledgement": true,
        "createdAt": "2026-04-12T07:00:00Z"
      }
    ]
  }
}
```

---

## 8.2 Acknowledge Dashboard Notification

### `POST /api/dashboard/notifications/{notificationId}/acknowledge`

Acknowledges a dashboard notification/banner.

#### Response

```json
{
  "data": {
    "success": true,
    "notificationId": "notif_1"
  }
}
```

---

# 9. Task Endpoints

## 9.1 List Tasks

### `GET /api/tasks`

Returns task list enriched with app metadata.

#### Query Parameters

- `projectId?: string`
- `sortBy?: "priority" | "difficulty" | "estimatedPoints" | "deadline"`
- `sortOrder?: "asc" | "desc"`
- `includeCompleted?: boolean` (default `false`)
- `page?: number`
- `pageSize?: number`

#### Response

```json
{
  "data": [
    {
      "id": "task_1",
      "todoistTaskId": "987654321",
      "projectId": "proj_1",
      "projectName": "Work",
      "title": "Prepare webinar slides",
      "description": null,
      "deadline": "2026-04-15",
      "hasSubtasks": true,
      "subtaskCount": 4,
      "completedSubtaskCount": 2,
      "progressPercent": 50,
      "eligibleForProgressTracking": true,
      "metadata": {
        "priority": "high",
        "difficulty": 6,
        "timeEstimateMinutes": 60,
        "completionBonusEnabled": true,
        "completionBonusPercent": 10,
        "badge": null,
        "customPointOverride": null
      },
      "estimatedPoints": 90,
      "isCompleted": false,
      "isDeadlineApproaching": true
    }
  ],
  "meta": {
    "page": 1,
    "pageSize": 20,
    "total": 1
  }
}
```

---

## 9.2 Get Task Details

### `GET /api/tasks/{taskId}`

Returns a task with subtasks and metadata.

#### Response

```json
{
  "data": {
    "id": "task_1",
    "todoistTaskId": "987654321",
    "projectId": "proj_1",
    "projectName": "Work",
    "title": "Prepare webinar slides",
    "deadline": "2026-04-15",
    "hasSubtasks": true,
    "progressPercent": 50,
    "eligibleForProgressTracking": true,
    "metadata": {
      "priority": "high",
      "difficulty": 6,
      "timeEstimateMinutes": 60,
      "completionBonusEnabled": true,
      "completionBonusPercent": 10,
      "badge": null,
      "customPointOverride": null
    },
    "estimatedPoints": 90,
    "subtasks": [
      {
        "id": "sub_1",
        "todoistTaskId": "987654322",
        "title": "Draft outline",
        "isCompleted": true,
        "earnedPoints": 30
      },
      {
        "id": "sub_2",
        "todoistTaskId": "987654323",
        "title": "Create visuals",
        "isCompleted": false,
        "earnedPoints": null
      }
    ]
  }
}
```

---

## 9.3 Upsert Task Metadata

### `PATCH /api/tasks/{taskId}/metadata`

Creates or updates app-specific metadata for a Todoist task.

#### Request Body

```json
{
  "priority": "high",
  "difficulty": 6,
  "timeEstimateMinutes": 60,
  "completionBonusEnabled": true,
  "completionBonusPercent": 10,
  "badge": "Deep Work",
  "customPointOverride": null
}
```

#### Validation Rules

- `priority` required
- `difficulty` required, integer `1..10`
- `timeEstimateMinutes` optional, must be `>= 0`
- `completionBonusPercent` required if `completionBonusEnabled = true`
- `completionBonusPercent` must be `>= 0`

#### Success Response

```json
{
  "data": {
    "taskId": "task_1",
    "metadata": {
      "priority": "high",
      "difficulty": 6,
      "timeEstimateMinutes": 60,
      "completionBonusEnabled": true,
      "completionBonusPercent": 10,
      "badge": "Deep Work",
      "customPointOverride": null
    }
  }
}
```

---

## 9.4 Batch Upsert Task Metadata

### `PATCH /api/tasks/metadata/batch`

Used when the frontend saves multiple task metadata changes in one action.

#### Request Body

```json
{
  "items": [
    {
      "taskId": "task_1",
      "priority": "high",
      "difficulty": 6,
      "timeEstimateMinutes": 60,
      "completionBonusEnabled": true,
      "completionBonusPercent": 10,
      "badge": null,
      "customPointOverride": null
    }
  ]
}
```

#### Response

```json
{
  "data": {
    "updated": 1,
    "items": [
      {
        "taskId": "task_1",
        "success": true
      }
    ]
  }
}
```

---

# 10. Reward Endpoints

## 10.1 List Rewards

### `GET /api/rewards`

Returns the user’s reward catalog.

#### Query Parameters

- `includeArchived?: boolean` (default `false`)
- `page?: number`
- `pageSize?: number`

#### Response

```json
{
  "data": [
    {
      "id": "rew_123",
      "name": "Cinema Night",
      "description": "One guilt-free movie night",
      "category": "entertainment",
      "costPoints": 250,
      "isArchived": false,
      "affordability": {
        "canRedeem": true,
        "missingPoints": 0
      },
      "createdAt": "2026-04-12T12:00:00Z",
      "updatedAt": "2026-04-12T12:00:00Z"
    }
  ],
  "meta": {
    "page": 1,
    "pageSize": 20,
    "total": 1
  }
}
```

---

## 10.2 Create Reward

### `POST /api/rewards`

#### Request Body

```json
{
  "name": "Cinema Night",
  "description": "One guilt-free movie night",
  "category": "entertainment",
  "costPoints": 250
}
```

#### Validation Rules

- `name` required
- `costPoints` required, integer `> 0`

#### Response

```json
{
  "data": {
    "id": "rew_123",
    "name": "Cinema Night",
    "description": "One guilt-free movie night",
    "category": "entertainment",
    "costPoints": 250,
    "isArchived": false,
    "affordability": {
      "canRedeem": true,
      "missingPoints": 0
    },
    "createdAt": "2026-04-12T12:00:00Z",
    "updatedAt": "2026-04-12T12:00:00Z"
  }
}
```

---

## 10.3 Update Reward

### `PATCH /api/rewards/{rewardId}`

#### Request Body

```json
{
  "name": "Cinema Night",
  "description": "One guilt-free movie night",
  "category": "entertainment",
  "costPoints": 300,
  "isArchived": false
}
```

#### Response

```json
{
  "data": {
    "id": "rew_123",
    "name": "Cinema Night",
    "description": "One guilt-free movie night",
    "category": "entertainment",
    "costPoints": 300,
    "isArchived": false,
    "affordability": {
      "canRedeem": true,
      "missingPoints": 0
    },
    "createdAt": "2026-04-12T12:00:00Z",
    "updatedAt": "2026-04-13T12:00:00Z"
  }
}
```

---

## 10.4 Delete Reward

### `DELETE /api/rewards/{rewardId}`

Deletes or archives the reward, depending on implementation policy.

#### Response
- `204 No Content`

---

## 10.5 Redeem Reward

### `POST /api/rewards/{rewardId}/redeem`

Redeems a reward if the user has sufficient points.

#### Request Body
Optional empty body.

#### Success Response

```json
{
  "data": {
    "success": true,
    "redemption": {
      "id": "red_123",
      "rewardId": "rew_123",
      "rewardName": "Cinema Night",
      "costPoints": 250,
      "redeemedAt": "2026-04-12T18:00:00Z"
    },
    "points": {
      "currentBalance": 610,
      "lifetimeEarned": 1420,
      "lifetimeSpent": 810
    }
  }
}
```

#### Insufficient Balance Response

`409 Conflict`

```json
{
  "error": {
    "code": "INSUFFICIENT_POINTS",
    "message": "Not enough points to redeem this reward",
    "details": {
      "rewardId": "rew_123",
      "missingPoints": 40
    }
  }
}
```

---

## 10.6 List Redemptions

### `GET /api/rewards/redemptions`

Returns reward redemption history.

#### Query Parameters

- `page?: number`
- `pageSize?: number`

#### Response

```json
{
  "data": [
    {
      "id": "red_123",
      "rewardId": "rew_123",
      "rewardName": "Cinema Night",
      "costPoints": 250,
      "redeemedAt": "2026-04-12T18:00:00Z"
    }
  ],
  "meta": {
    "page": 1,
    "pageSize": 20,
    "total": 1
  }
}
```

---

# 11. Settings Endpoints

## 11.1 Get Global Settings

### `GET /api/settings`

Returns all user-configurable settings needed by the settings page.

#### Response

```json
{
  "data": {
    "points": {
      "difficultyMultiplierBase": 10,
      "priorityMultipliers": {
        "low": 1.0,
        "medium": 1.25,
        "high": 1.5
      },
      "defaultCompletionBonusEnabled": true,
      "defaultCompletionBonusPercent": 10
    },
    "streak": {
      "ruleType": "points",
      "ruleValue": 20,
      "protectionEnabled": true,
      "startingProtectionBalance": 3,
      "protectionRewardEveryNDays": 10,
      "protectionRewardAmount": 1,
      "bonusStrategy": "fixed",
      "milestones": [
        {
          "days": 7,
          "value": 50
        },
        {
          "days": 14,
          "value": 150
        },
        {
          "days": 30,
          "value": 500
        }
      ]
    }
  }
}
```

---

## 11.2 Update Global Settings

### `PATCH /api/settings`

Updates one or more global settings sections.

#### Request Body

```json
{
  "points": {
    "difficultyMultiplierBase": 10,
    "priorityMultipliers": {
      "low": 1.0,
      "medium": 1.25,
      "high": 1.5
    },
    "defaultCompletionBonusEnabled": true,
    "defaultCompletionBonusPercent": 10
  },
  "streak": {
    "ruleType": "points",
    "ruleValue": 20,
    "protectionEnabled": true,
    "startingProtectionBalance": 3,
    "protectionRewardEveryNDays": 10,
    "protectionRewardAmount": 1,
    "bonusStrategy": "fixed",
    "milestones": [
      {
        "days": 7,
        "value": 50
      }
    ]
  }
}
```

#### Validation Rules

- `difficultyMultiplierBase > 0`
- all priority multipliers `> 0`
- `defaultCompletionBonusPercent >= 0`
- `ruleType` must be `tasks` or `points`
- `ruleValue > 0`
- `bonusStrategy` must be `fixed` or `percentage`
- milestone days must be unique positive integers

#### Response

```json
{
  "data": {
    "success": true,
    "settings": {
      "points": {
        "difficultyMultiplierBase": 10,
        "priorityMultipliers": {
          "low": 1.0,
          "medium": 1.25,
          "high": 1.5
        },
        "defaultCompletionBonusEnabled": true,
        "defaultCompletionBonusPercent": 10
      },
      "streak": {
        "ruleType": "points",
        "ruleValue": 20,
        "protectionEnabled": true,
        "startingProtectionBalance": 3,
        "protectionRewardEveryNDays": 10,
        "protectionRewardAmount": 1,
        "bonusStrategy": "fixed",
        "milestones": [
          {
            "days": 7,
            "value": 50
          }
        ]
      }
    }
  }
}
```

---

# 12. Ledger Endpoints

## 12.1 List Ledger Transactions

### `GET /api/ledger`

Returns points transaction history.

#### Query Parameters

- `type?: "earned" | "spent" | "bonus" | "adjusted"`
- `source?: string`
- `from?: ISODateString`
- `to?: ISODateString`
- `page?: number`
- `pageSize?: number`

#### Response

```json
{
  "data": [
    {
      "id": "txn_123",
      "type": "earned",
      "amount": 75,
      "description": "Completed subtask: Draft architecture",
      "source": "subtask_completion",
      "relatedEntityType": "subtask",
      "relatedEntityId": "task_abc_sub_1",
      "createdAt": "2026-04-12T12:00:00Z"
    }
  ],
  "meta": {
    "page": 1,
    "pageSize": 20,
    "total": 1
  }
}
```

---

## 12.2 Manual Adjustment

### `POST /api/ledger/adjustments`

Creates a manual points adjustment.

#### Request Body

```json
{
  "amount": -20,
  "reason": "Incorrect manual award reversal"
}
```

#### Validation Rules

- `amount` must be non-zero integer
- `reason` required, minimum length recommended: 3

#### Response

```json
{
  "data": {
    "transaction": {
      "id": "txn_adj_1",
      "type": "adjusted",
      "amount": -20,
      "description": "Manual adjustment",
      "source": "manual_adjustment",
      "relatedEntityType": null,
      "relatedEntityId": null,
      "createdAt": "2026-04-12T12:00:00Z"
    },
    "points": {
      "currentBalance": 840,
      "lifetimeEarned": 1420,
      "lifetimeSpent": 580
    }
  }
}
```

---

# 13. Analytics Endpoints

## 13.1 Analytics Summary

### `GET /api/analytics/summary`

Returns lightweight analytics for MVP.

#### Response

```json
{
  "data": {
    "mostRewardingProjects": [
      {
        "projectId": "proj_1",
        "projectName": "Work",
        "pointsEarned": 640
      }
    ],
    "streakHistory": {
      "current": 6,
      "longest": 14,
      "milestonesReached": [7, 14]
    }
  }
}
```

---

# 14. Internal / System Endpoints

These endpoints are primarily backend-facing and are not intended for routine frontend use.

## 14.1 Todoist Webhook Receiver

### `POST /api/todoist/webhook`

Receives Todoist webhook events.

#### Request
- raw webhook payload from Todoist
- signature headers validated by backend

#### Success Response

```json
{
  "data": {
    "received": true
  }
}
```

#### Notes
- frontend should never call this endpoint
- handler must be idempotent
- backend should acknowledge quickly

---

## 14.2 Manual Reconciliation Trigger

### `POST /api/internal/reconcile`

Runs reconciliation manually.

#### Access Policy
- only enabled in admin/dev/internal contexts

#### Response

```json
{
  "data": {
    "started": true,
    "message": "Reconciliation triggered"
  }
}
```

---

# 15. Pagination, Sorting, and Filtering Contract

## 15.1 Pagination

Collection endpoints that support pagination must accept:

- `page` (default `1`)
- `pageSize` (default `20`, maximum suggested `100`)

And return:

```json
{
  "meta": {
    "page": 1,
    "pageSize": 20,
    "total": 100
  }
}
```

## 15.2 Sorting

If an endpoint supports sorting, the backend must validate `sortBy` and `sortOrder` against the documented allowlist.

Unknown sort values must return `422`.

## 15.3 Filtering

Query filters must be optional and ignored only when absent.

Invalid filter formats must return `422`.

---

# 16. Validation Contract

## 16.1 Request Validation

All write endpoints must validate:

- required fields
- enum membership
- numeric ranges
- string length where relevant
- structural payload correctness

## 16.2 Validation Error Response

Validation failures must return `422`:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "One or more fields are invalid",
    "details": {
      "fields": {
        "difficulty": "Must be between 1 and 10",
        "priority": "Invalid priority value"
      }
    }
  }
}
```

---

# 17. Idempotency and Consistency Rules

## 17.1 Frontend-triggered Writes

The frontend should avoid submitting duplicate actions, but the backend remains authoritative.

## 17.2 Sensitive Actions

The following operations must be implemented transactionally:

- reward redemption
- manual adjustment
- webhook point award processing
- reconciliation fixes
- streak protection consumption

## 17.3 Idempotency Guidance

Recommended future extension:

- support an `Idempotency-Key` header on action endpoints like reward redemption or manual adjustments

MVP minimum:
- backend must ensure duplicate webhook deliveries do not double-award points

---

# 18. Frontend Implementation Notes

## 18.1 Frontend Expectations

The frontend should:

- use these endpoints as the only source of app data
- avoid inferring undocumented fields
- handle loading, empty, and error states explicitly
- rely on `affordability.canRedeem` rather than reimplementing reward eligibility logic client-side
- treat dashboard notifications as server-driven state

## 18.2 Optimistic Updates

For MVP:

- do **not** use optimistic updates for points balance, streaks, or reward redemption
- prefer server-confirmed state after each mutation

Reason:
These values are derived from transactional backend logic and should remain consistent.

---

# 19. Backend Implementation Notes

The backend should:

- keep endpoint handlers thin
- place business logic in services
- keep database writes transactional
- ensure all user-scoped reads/writes are session-scoped
- keep DTO shapes stable
- centralize response serialization where possible

---

# 20. Open Decisions / Future Extensions

The following may be added later but are not required for MVP:

- stronger versioning strategy, e.g. `/api/v1`
- explicit ETag / caching strategy
- explicit `Idempotency-Key` support on more endpoints
- SSE or WebSocket live dashboard refresh
- advanced analytics endpoints
- bulk reward import/export

---

# 21. Recommended Implementation Order

1. `GET /api/auth/session`
2. `GET /api/dashboard`
3. `GET /api/tasks`
4. `GET /api/tasks/{taskId}`
5. `PATCH /api/tasks/{taskId}/metadata`
6. `GET /api/rewards`
7. `POST /api/rewards`
8. `PATCH /api/rewards/{rewardId}`
9. `POST /api/rewards/{rewardId}/redeem`
10. `GET /api/settings`
11. `PATCH /api/settings`
12. `GET /api/ledger`
13. `POST /api/ledger/adjustments`
14. `GET /api/analytics/summary`
15. internal webhook + reconciliation endpoints

---

# 22. Final Summary

This API specification defines the **contract between frontend and backend** for the Todoist Gamification Companion App MVP.

It standardizes:

- endpoint structure
- payload shapes
- error handling
- settings management
- task metadata handling
- rewards and redemptions
- ledger history
- dashboard data access
- analytics access
- internal operational endpoints

This document should now be used as the implementation contract for both sides of the application.
