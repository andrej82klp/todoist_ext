# Technical Architecture Document

## Todoist Gamification Companion App

***

## 1. Purpose

This document defines the **technical architecture** for the Todoist Gamification Companion App MVP. It translates the approved PRD into an implementation-ready system design covering:

*   application architecture
*   runtime topology
*   integration design
*   data ownership
*   sync strategy
*   security
*   scalability
*   deployment structure

The app will be built as a **Nuxt 4 full-stack web application** using **Nitro** for server runtime and API routes, with **Neon Postgres** as the primary database. Nuxt uses Nitro as its server engine, and Nitro supports server handlers/plugins/routes suitable for colocating backend logic with the frontend in one codebase. Neon is a serverless Postgres platform with autoscaling and branching, which fits well for an MVP and future preview-environment workflows. [\[nuxt.com\]](https://nuxt.com/docs/4.x/api/kit/nitro), [\[neon.com\]](https://neon.com/docs/introduction)

***

## 2. Architecture Goals

The architecture should satisfy the following goals:

1.  **Keep Todoist as the source of truth** for projects, tasks, and subtasks.
2.  **Add a separate app-owned gamification layer** without modifying Todoist data.
3.  **Support near real-time completion handling** through webhooks, with a scheduled fallback.
4.  **Keep the system simple for MVP** while preserving a path to multi-user expansion.
5.  **Provide strong traceability** for point changes through an immutable-style transaction ledger.
6.  **Centralize configuration** via global settings while allowing future extensibility.
7.  **Avoid unnecessary microservices** at MVP stage by using a modular monolith approach.

***

## 3. Architectural Style

### Recommended Style: Modular Monolith

For MVP, the recommended architecture is a **modular monolith**:

*   **single Nuxt 4 repository**
*   **single deployable web application**
*   **frontend and backend colocated**
*   **clear internal module boundaries**
*   **single Neon database**
*   **background jobs executed within the same deployment boundary or via platform scheduler**

This is the best fit because Nuxt 4 + Nitro already supports full-stack application development with server handlers and runtime extensions, allowing API endpoints, middleware, and server utilities in one codebase. [\[nuxt.com\]](https://nuxt.com/docs/4.x/api/kit/nitro)

### Why this is the right choice

A separate backend service would add deployment, auth, networking, and observability complexity too early. The MVP does not yet need service decomposition. The expected workload—single-user initially, event-driven webhook processing, dashboard reads, and nightly reconciliation—is well within a modular monolith’s comfort zone.

***

## 4. High-Level System Context

### External Systems

*   **Todoist API**  
    Used for OAuth, initial data fetch, and read-only synchronization. Todoist documents OAuth-based authorization, bearer-token API access, REST-style endpoints, and a `/sync` endpoint for keeping account state updated locally. [\[developer....odoist.com\]](https://developer.todoist.com/api/v1/)

*   **Todoist Webhooks**  
    Used for completion detection in near real time, per the validated requirement set.

*   **Neon Postgres**  
    Stores all app-owned data: metadata, rewards, ledger, streaks, settings, mappings, and analytics support tables. Neon is positioned as serverless Postgres with autoscaling and branching support. [\[neon.com\]](https://neon.com/docs/introduction)

### Internal System

*   **Nuxt 4 app**
    *   Vue frontend
    *   Nitro server runtime
    *   API routes
    *   webhook endpoint
    *   scheduled jobs / reconciliation handlers
    *   domain services
    *   persistence layer

***

## 5. Logical Architecture

```text
+--------------------------------------------------------------+
|                        Browser Client                        |
|  Dashboard | Task List | Reward Shop | Settings              |
+------------------------------+-------------------------------+
                               |
                               v
+--------------------------------------------------------------+
|                      Nuxt 4 Application                      |
|--------------------------------------------------------------|
| UI Layer                                                     |
| - pages/                                                     |
| - layouts/                                                   |
| - components/                                                |
|                                                              |
| Server Layer (Nitro)                                         |
| - API routes                                                 |
| - OAuth callback handler                                     |
| - Todoist webhook endpoint                                   |
| - scheduled reconciliation endpoint/job                      |
| - auth/session utilities                                     |
|                                                              |
| Domain Modules                                               |
| - Todoist Sync Module                                        |
| - Progress & Points Engine                                   |
| - Streak Engine                                              |
| - Rewards Module                                             |
| - Settings Module                                            |
| - Analytics Read Model                                       |
| - Notifications/Banners state                                |
|                                                              |
| Data Access Layer                                            |
| - repositories                                               |
| - transaction boundaries                                     |
+------------------------------+-------------------------------+
                               |
                               v
+--------------------------------------------------------------+
|                        Neon Postgres                         |
| users | todoist_mappings | task_metadata | rewards           |
| ledger | streaks | settings | redemptions | analytics        |
+--------------------------------------------------------------+

External:
Todoist OAuth / API / Webhooks
```

***

## 6. Runtime Topology

### 6.1 Frontend Runtime

The frontend is rendered by Nuxt and served from the same app deployment. The app will use Nuxt’s page-based routing and component architecture for the four MVP views:

*   Dashboard
*   Task List
*   Reward Shop
*   Settings

### 6.2 Backend Runtime

Nitro will host:

*   REST-style internal API routes
*   OAuth callback handlers
*   webhook receiver endpoint
*   server middleware
*   reusable server utilities
*   reconciliation job endpoints / handlers

Nuxt documents Nitro as the server engine and supports server handlers, plugins, middleware, and scanned server directories for API/server code organization. [\[nuxt.com\]](https://nuxt.com/docs/4.x/api/kit/nitro)

### 6.3 Database Runtime

Neon Postgres serves as the system-of-record for all app-owned data. Neon’s branching capability is also useful for future preview deployments and testing workflows. [\[neon.com\]](https://neon.com/docs/introduction)

***

## 7. Core Components

## 7.1 Presentation Layer

### Responsibilities

*   render dashboard and views
*   display points, streaks, rewards, analytics
*   surface streak-protection banner
*   allow configuration of scoring and streak rules
*   present reward redemption actions
*   present task metadata in a read-only Todoist companion experience

### Key UI Modules

*   `dashboard`
*   `task-list`
*   `reward-shop`
*   `settings`
*   `common` (navigation, banner, cards, tables)

### Design principle

The UI should remain **motivation-first**, while task ownership remains conceptually in Todoist.

***

## 7.2 API Layer

### Responsibilities

Expose internal endpoints for:

*   current user session
*   dashboard data
*   tasks + metadata
*   rewards
*   settings
*   ledger history
*   analytics summaries
*   OAuth callback
*   webhook ingestion
*   manual refresh / reconciliation trigger (if enabled for admin/dev use)

### Suggested route groups

```text
/api/auth/*
/api/dashboard/*
/api/tasks/*
/api/rewards/*
/api/settings/*
/api/ledger/*
/api/analytics/*
/api/todoist/webhook
/api/internal/reconcile
```

### Design rule

The API layer should be **thin**: validate input, authorize request, delegate to domain services, return DTOs.

***

## 7.3 Domain Service Layer

This is the most important internal boundary.

### Modules

#### 1. Todoist Sync Module

Handles:

*   initial import
*   fetch/update mappings
*   webhook event normalization
*   nightly reconciliation
*   Todoist API reads
*   data consistency with app-owned metadata

Todoist documents both REST-style APIs and a `/sync` endpoint intended for keeping local state updated. [\[developer....odoist.com\]](https://developer.todoist.com/api/v1/)

#### 2. Progress & Points Engine

Handles:

*   progress calculation for parent task groups with subtasks
*   per-subtask scoring (priority × difficulty × base multiplier)
*   fixed completion bonus award when all sibling subtasks complete
*   parent group total computation (subtask points total + completion bonus)
*   transaction creation
*   idempotent award logic

#### 3. Streak Engine

Handles:

*   daily qualification checks
*   streak continuation/break logic
*   automatic streak protection consumption
*   milestone bonus calculation
*   banner state creation for next-day acknowledgement

#### 4. Rewards Module

Handles:

*   reward catalog CRUD
*   affordability checks
*   redemption
*   ledger entry creation

#### 5. Settings Module

Handles:

*   global scoring rules
*   priority multipliers
*   streak rule configuration
*   milestone thresholds and values
*   reward catalog configuration

#### 6. Analytics Read Model

Handles:

*   most rewarding projects
*   streak summaries
*   lightweight aggregations
*   dashboard-ready projections

***

## 7.4 Persistence Layer

A repository-based data access layer should sit between domain services and the database.

### Responsibilities

*   encapsulate SQL/ORM access
*   enforce transactional boundaries
*   centralize optimistic/idempotent persistence patterns
*   return domain models or DTO-ready projections

### Important rule

Any operation that changes:

*   points balance
*   points ledger
*   streak state
*   redemption status  
    must occur inside a **single database transaction**.

***

## 8. Data Ownership Model

### Todoist-owned data

*   projects
*   tasks
*   subtasks
*   completion state
*   structure and identifiers

### App-owned data

*   task metadata
*   points settings
*   rewards
*   reward redemption history
*   streak state
*   streak protection balance
*   milestone history
*   points ledger
*   analytics summaries
*   user preferences

### Hybrid mapping layer

A mapping table should associate Todoist resource IDs with local records so app-specific metadata can be attached cleanly.

### Guiding principle

The app should **cache only what it needs** from Todoist and treat Todoist as the authoritative upstream source.

***

## 9. Authentication and Authorization Architecture

Todoist supports OAuth 2.0 authorization, including authorization-code flow, redirect URI validation, bearer access tokens, configurable scopes, refresh tokens for newer apps, and token refresh exchange. [\[developer....odoist.com\]](https://developer.todoist.com/api/v1/)

## 9.1 Login Flow

1.  User clicks “Connect Todoist”
2.  Redirect to Todoist OAuth authorization endpoint
3.  User grants access
4.  Todoist redirects back with authorization code + state
5.  Server exchanges code for access token
6.  Token and refresh token (if issued) are stored securely server-side
7.  Local user record is created or linked
8.  Initial sync begins

## 9.2 Recommended Auth Storage

Store server-side only:

*   access token
*   refresh token (if applicable)
*   token expiry
*   scope
*   Todoist user ID / identity mapping

Do **not** store Todoist password or use local credential auth.

## 9.3 Session Model

Use an app session cookie for the web app.  
The browser should never directly call Todoist with bearer tokens.

***

## 10. Sync and Event Processing Architecture

## 10.1 Initial Sync

Triggered immediately after successful OAuth.

### Steps

1.  Fetch Todoist projects/tasks/subtasks
2.  Persist mappings
3.  Seed local read models
4.  Create missing metadata records lazily or on demand
5.  Compute initial dashboard state

### Note

If Todoist temporary IDs ever appear in a client-side context, Todoist advises waiting for synced, server-valid IDs before issuing API calls. [\[developer....odoist.com\]](https://developer.todoist.com/api/v1/)

***

## 10.2 Webhook Processing

### Goal

Handle task completion in near real time.

### Endpoint

`POST /api/todoist/webhook`

### Processing pipeline

1.  Receive webhook
2.  Verify request signature according to the validated webhook requirement
3.  Extract delivery/event identifier
4.  Check idempotency table
5.  ACK quickly
6.  Process event asynchronously or immediately if lightweight
7.  Resolve Todoist entity mapping
8.  Apply point rules
9.  Update streak state
10. Insert ledger entries
11. Store processed-delivery record

### Idempotency requirement

Webhook processing **must be idempotent** to avoid duplicate point awards.

### Reliability pattern

Use:

*   dedupe by delivery/event key
*   transactionally write ledger + balance + streak change
*   mark event processed only after success

***

## 10.3 Nightly Reconciliation

### Purpose

Recover from:

*   missed webhooks
*   delayed processing
*   deployment downtime
*   mapping drift

### Schedule

Nightly at **1:00 AM**.

### Steps

1.  Read previous-day completion candidates from Todoist
2.  Compare against processed ledger entries
3.  Insert missing awards
4.  recompute any affected streak states if required
5.  emit reconciliation log summary

This job is a **safety net**, not the primary sync path.

***

## 11. Points and Streak Calculation Architecture

## 11.1 Calculation Strategy

Business rules should live in a **pure domain service**, not inside controllers or UI components.

### Default formulas

*   Base points = `difficulty × 10`
*   Priority multipliers:
    *   Low = `1.0`
    *   Medium = `1.25`
    *   High = `1.5`
*   Completion bonus = fixed integer per parent task (default: 0); configured in parent task metadata
*   Parent estimated points = sum of all subtask estimated points + completion bonus

These multiplier values can be overridden via settings.

## 11.2 Calculation Events

Award events:

*   subtask completion
*   task fully completed
*   streak milestone reached
*   manual adjustment
*   reward redemption deduction

## 11.3 Ledger-first design

Every balance change must originate from a ledger transaction.  
Balance should be derived transactionally from ledger writes, not managed as an independent uncontrolled number.

***

## 12. Database Architecture

Neon is suitable here because it provides managed Postgres with serverless characteristics and branching support for development workflows. [\[neon.com\]](https://neon.com/docs/introduction)

## 12.1 Core Table Groups

Suggested logical table groups:

### Identity & integration

*   `users`
*   `oauth_accounts`
*   `todoist_item_mappings`
*   `webhook_deliveries`

### Task extension

*   `task_metadata`
*   `subtask_metadata`

### Rewards & economy

*   `rewards`
*   `reward_redemptions`
*   `point_ledger`
*   `point_balances` *(optional denormalized projection)*

### Streaks

*   `streak_state`
*   `streak_history`
*   `streak_protection`
*   `milestone_definitions`
*   `milestone_awards`

### Settings

*   `global_settings`
*   `scoring_rules`
*   `streak_rules`

### Analytics

*   `project_point_aggregates`
*   `dashboard_snapshots` *(optional read model)*

## 12.2 Transaction Boundaries

The following should be atomic:

*   award points + create ledger row + update balance + update streak
*   redeem reward + create ledger row + decrement balance + create redemption row
*   consume streak protection + update streak state + create banner notification state

***

## 13. Suggested Nuxt Project Structure

```text
app/
components/
layouts/
pages/
  index.vue
  tasks.vue
  rewards.vue
  settings.vue

server/
  api/
    auth/
    dashboard/
    tasks/
    rewards/
    settings/
    ledger/
    analytics/
    todoist/
      webhook.post.ts
    internal/
      reconcile.post.ts
  middleware/
  utils/
  services/
    todoist/
    points/
    streaks/
    rewards/
    settings/
    analytics/
  repositories/
  db/
  plugins/

shared/
  types/
  constants/
  schemas/
```

### Structure rationale

Nuxt/Nitro supports scanned server folders, handlers, utilities, and plugins, making this structure a natural fit for modular organization inside a single repo. [\[nuxt.com\]](https://nuxt.com/docs/4.x/api/kit/nitro)

***

## 14. Security Architecture

## 14.1 Core Security Controls

*   OAuth state validation
*   secure token storage on server
*   least-privilege Todoist scope selection (read-oriented)
*   webhook signature verification
*   CSRF protection for app session flows
*   input validation on all write APIs
*   audit trail for manual point adjustments
*   server-only database credentials
*   environment-variable based secret management

## 14.2 Webhook Security

*   verify signature before processing
*   reject unsigned/invalid requests
*   dedupe delivery identifiers
*   return fast acknowledgements
*   avoid expensive synchronous downstream calls before ACK

## 14.3 Data Protection

Sensitive data:

*   OAuth access tokens
*   refresh tokens
*   user mapping identifiers

Recommended controls:

*   encrypt at rest where platform supports it
*   avoid sending tokens to client
*   redact secrets from logs

***

## 15. Observability and Operations

## 15.1 Logging

Structured logs for:

*   OAuth callback outcome
*   webhook receipt
*   webhook verification result
*   idempotency outcome
*   point awards
*   redemption attempts
*   nightly reconciliation summary
*   token refresh failures

## 15.2 Metrics

Track:

*   webhook count
*   webhook failures
*   duplicate delivery count
*   average webhook processing time
*   nightly reconciliation repairs
*   API response times
*   reward redemption count
*   streak protection usage count

## 15.3 Error Monitoring

Use centralized error capture for:

*   OAuth errors
*   DB transaction errors
*   webhook parsing failures
*   Todoist API failures
*   scheduled job failures

***

## 16. Scalability and Evolution

## 16.1 MVP Scalability

The architecture is already sufficient for:

*   single-user
*   light multi-user usage
*   moderate webhook volume
*   dashboard traffic
*   preview environments

## 16.2 Evolution Path

If usage grows, split gradually:

1.  **Keep frontend in Nuxt**
2.  Extract **webhook processing** into worker/queue
3.  Extract **analytics projections** into background jobs
4.  Introduce **message queue** only when needed
5.  Keep Neon as primary transactional store

## 16.3 Why not queue-first now?

A queue adds operational complexity that the MVP likely does not need yet. Start with transactional idempotent processing and a fallback reconciliation job.

***

## 17. Deployment Architecture

## 17.1 Environments

Recommended environments:

*   `local`
*   `dev`
*   `preview`
*   `prod`

## 17.2 Database Strategy

Use Neon branches for:

*   feature previews
*   integration testing
*   migration validation

Neon explicitly positions branching as part of its workflow story, which makes it attractive for preview and isolated testing environments. [\[neon.com\]](https://neon.com/docs/introduction)

## 17.3 Deployment Unit

Single deployment artifact:

*   Nuxt frontend
*   Nitro backend routes
*   shared codebase

## 17.4 Scheduler

Use hosting-platform scheduler or cron mechanism to invoke the nightly reconciliation route/job.

***

## 18. Key Architectural Decisions

### Decision 1: Use Nuxt 4 as both frontend and backend

**Reason:** reduces complexity, improves developer speed, keeps shared types and domain logic in one repo. Nuxt uses Nitro as its server engine and supports first-class server handlers/plugins. [\[nuxt.com\]](https://nuxt.com/docs/4.x/api/kit/nitro)

### Decision 2: Use Neon as primary database

**Reason:** managed Postgres, serverless-friendly, branching for preview environments, good fit for MVP and future scale. [\[neon.com\]](https://neon.com/docs/introduction)

### Decision 3: Prefer webhook-first completion detection

**Reason:** better timeliness and less polling overhead.

### Decision 4: Add nightly reconciliation

**Reason:** improves correctness and recoverability.

### Decision 5: Ledger-first points model

**Reason:** strongest traceability, easiest debugging, safer reward accounting.

### Decision 6: Build as modular monolith first

**Reason:** fastest MVP path without premature service fragmentation.

***

## 19. Implementation Priorities

### Phase 1

*   Nuxt app scaffold
*   Neon connection
*   auth/session foundation
*   Todoist OAuth flow
*   base schema

### Phase 2

*   initial sync
*   item mappings
*   task metadata
*   settings

### Phase 3

*   webhook endpoint
*   idempotent event processing
*   points engine
*   streak engine

### Phase 4

*   dashboard
*   task list
*   reward shop
*   redemption

### Phase 5

*   nightly reconciliation
*   analytics read model
*   observability hardening

***

## 20. Final Recommendation

The strongest architecture for this MVP is:

*   **Nuxt 4 full-stack modular monolith**
*   **Nitro-hosted internal APIs and webhook handlers**
*   **Neon Postgres as the single transactional store**
*   **Todoist OAuth + read-only sync**
*   **webhook-first event handling with nightly reconciliation fallback**
*   **ledger-first accounting model**
*   **domain-driven internal modules with strict separation of concerns**

This design is simple enough to build quickly, but solid enough to scale into a multi-user product later without rewriting the foundations.


## 21. Sequence Diagrams

### 21.1 OAuth Login and Initial Sync

sequenceDiagram
    autonumber
    participant U as User
    participant B as Browser
    participant A as Nuxt App
    participant T as Todoist OAuth/API
    participant DB as Neon Postgres

    U->>B: Click "Connect Todoist"
    B->>T: Redirect to OAuth authorize endpoint
    T-->>B: Redirect back with code + state
    B->>A: Call OAuth callback route
    A->>A: Validate state
    A->>T: Exchange code for access token
    T-->>A: Access token (+ refresh token if enabled)
    A->>DB: Upsert user + OAuth account
    A->>T: Fetch projects, tasks, subtasks
    T-->>A: Todoist data
    A->>DB: Persist mappings and seed app-owned records
    A->>A: Compute initial dashboard state
    A-->>B: Create session and redirect to Dashboard
    B-->>U: Dashboard displayed

### 21.2 Webhook Processing

sequenceDiagram
    autonumber
    participant T as Todoist Webhook
    participant W as Webhook Endpoint
    participant S as Todoist Sync Service
    participant P as Points Engine
    participant ST as Streak Engine
    participant DB as Neon Postgres

    T->>W: POST completion event
    W->>W: Verify signature
    W->>DB: Check delivery/event idempotency
    alt Already processed
        DB-->>W: Duplicate found
        W-->>T: 200 OK
    else New delivery
        W-->>T: 200 OK (fast ack)
        W->>S: Normalize event and resolve mapping
        S->>DB: Read Todoist item mapping + metadata
        DB-->>S: Mapping + scoring config
        S->>P: Calculate earned points
        P->>DB: Insert ledger entry + update balance
        S->>ST: Re-evaluate daily streak state
        ST->>DB: Update streak / protection / milestone awards
        S->>DB: Mark delivery as processed
    end


### 21.3 Nightly Reconciliation Flow

sequenceDiagram
    autonumber
    participant C as Scheduler/Cron
    participant R as Reconciliation Job
    participant T as Todoist API
    participant DB as Neon Postgres
    participant P as Points Engine
    participant ST as Streak Engine

    C->>R: Trigger nightly job at 1:00 AM
    R->>DB: Read last successful checkpoint
    R->>T: Fetch prior-day completed tasks/subtasks
    T-->>R: Completion data
    R->>DB: Compare against processed deliveries and ledger
    loop For each missing completion
        R->>DB: Load mapping + metadata
        R->>P: Recalculate points for missing event
        P->>DB: Insert missing ledger entry + update balance
        R->>ST: Recompute affected streak state if needed
        ST->>DB: Persist streak changes
    end
    R->>DB: Store reconciliation summary + new checkpoint