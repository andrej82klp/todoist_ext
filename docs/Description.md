# Todoist Gamification Companion App

***

## 1. Introduction

This project is a **Todoist companion app** designed to improve motivation, consistency, and follow-through through **gamification**.

Todoist remains the primary system for managing projects, tasks, and subtasks. This app does **not replace Todoist**. Instead, it extends Todoist with additional functionality such as:

*   custom task scoring
*   progress-based rewards
*   streak tracking
*   virtual currency
*   reward redemption
*   lightweight productivity analytics

The goal is to make progress feel visible and rewarding — not only when a task is fully completed, but also when meaningful progress is made along the way.

***

## 2. Product Vision

The app should transform task execution into a **reward-driven experience** that encourages both consistency and completion.

Instead of only rewarding finished tasks, the app should also recognize intermediate progress on larger goals. This is achieved by combining:

*   subtask-based progress tracking
*   configurable points logic
*   streak-based reinforcement
*   a personal reward economy

Points act as a **virtual currency** that the user can accumulate and exchange for self-defined real-world rewards, such as meals, entertainment, or personal purchases.

***

## 3. Product Scope

### 3.1 In-Scope Concept

The app connects to Todoist in **read-only mode**, imports task structure, and overlays a gamification system on top of it.

It should support:

*   syncing Todoist projects, tasks, and subtasks
*   attaching app-specific metadata to Todoist items
*   calculating progress and points
*   maintaining streaks and streak bonuses
*   tracking a points balance and full ledger
*   supporting reward redemption
*   presenting progress in a motivation-first dashboard

### 3.2 Out-of-Scope Concept

The app is **not** intended to replace Todoist or manage tasks independently.

Specifically, the app should **not**:

*   create tasks in Todoist
*   edit tasks in Todoist
*   delete tasks in Todoist
*   act as a standalone task manager

Todoist remains the source of truth for task structure and completion state.

***

## 4. Core Functional Requirements

***

### 4.1 Todoist Integration

The app will connect to the user’s Todoist account and fetch:

*   Projects
*   Tasks
*   Subtasks

The mapping is direct:

*   **Todoist Project → App Project**
*   **Todoist Task → App Task**
*   **Todoist Subtask → App Subtask**

There is no native Todoist milestone concept, so milestones will be modeled inside the app only where needed.

***

### 4.2 Metadata Extension

The app will store metadata that Todoist does not natively support.

For each relevant Todoist item, the user should be able to configure:

*   **Priority level** (Low, Medium, High)
*   **Difficulty score** (1–10)
*   **Time estimate** (minutes / hours)
*   **Points configuration**
*   **Optional completion bonus**
*   **Optional visual badges**

This metadata is stored in the app database and linked to the corresponding Todoist item.

***

### 4.3 Progress Tracking

Progress tracking is **percentage-based** and depends on subtasks.

#### Rules

*   Only tasks with **at least one subtask** are eligible for progress tracking
*   Tasks without subtasks are ignored by the app’s progress-tracking system
*   Progress is calculated based on subtask completion
*   If subtasks are added or removed later, progress is recalculated using the updated total
*   A completed subtask is assumed to **never be reopened** in Todoist

#### Purpose

This allows the app to reward partial completion of larger tasks and make progress visible before the full task is finished.

***

### 4.4 Points System

The app introduces a **virtual points economy** that rewards both progress and completion.

#### Point Sources

Users can earn points from:

*   completing subtasks
*   completing a full task
*   achieving streak milestones
*   manual adjustments (if explicitly applied by the user with a reason)

#### Default Scoring Formula

Each subtask’s points are calculated using:

*   **Difficulty score** as the base value
*   **Priority** as a multiplier

##### Base points formula

```text
Base points = Difficulty × 10
```

Examples:

*   Difficulty 2 → 20 points
*   Difficulty 5 → 50 points
*   Difficulty 10 → 100 points

##### Default priority multipliers

*   **Low:** 1.0×
*   **Medium:** 1.25×
*   **High:** 1.5×

##### Subtask points formula

```text
Subtask points = (Difficulty × 10) × Priority Multiplier
```

These rules should be configurable through global settings.

***

### 4.5 Task Completion Bonus

When all subtasks of a task are completed, the user may receive an additional completion bonus.

#### Default rule

*   Task completion bonus = **10% of total points earned from subtasks**

##### Formula

```text
Task completion bonus = Total subtask points × 10%
```

This bonus is configurable and optional.

***

### 4.6 Badges

Badges are **visual-only achievements**.

They are intended to:

*   reinforce motivation
*   celebrate activity or milestones
*   make progress more engaging

Badges do **not** affect scoring or point balances.

***

### 4.7 Reward System

The app should allow the user to define a personal catalog of rewards that can be redeemed using earned points.

Examples:

*   meals
*   entertainment
*   personal purchases
*   self-care perks
*   custom rewards

Each reward should have:

*   name
*   point cost
*   optional category
*   optional description

#### Redemption Rules

*   rewards can be redeemed multiple times
*   redemption is only possible if the user has enough points
*   if the balance is insufficient, redemption should be disabled rather than blocked by error after submission

***

## 5. Streak System

***

### 5.1 Streak Definition

A streak is maintained when the user meets a configurable daily requirement.

The app should support at least these rule types:

*   complete at least **one task or subtask** per day
*   earn at least **a minimum number of points** per day

The user should be able to choose which streak rule applies.

***

### 5.2 Streak Break Condition

A streak is broken when the user fails to satisfy the configured daily requirement, unless **streak protection** is available and enabled.

***

### 5.3 Streak Protection

The app should include a separate **streak protection balance**.

#### Default behavior

*   starting balance: **3 protection days**
*   completing a **10-day streak** grants **+1 protection day**

#### Rules

*   streak protection is applied **automatically**
*   when used, the app should show a notification the next day
*   the notification appears as a **small red banner at the bottom of the page**
*   the notification must explain:
    *   that streak protection was used
    *   how many protection days remain
*   the user must acknowledge the banner (e.g. dismiss using an **X** button)

The feature should also be configurable and may be turned **off** entirely for a stricter streak experience.

***

### 5.4 Streak Milestone Bonuses

The app should award bonus points for reaching streak milestones.

For the MVP, milestones are **predefined** and tied only to streak length. They are not used for organizing tasks.

Examples:

*   7-day streak
*   14-day streak
*   30-day streak

These milestones affect scoring by granting bonus points.

***

### 5.5 Streak Bonus Strategies

The user should be able to choose between two strategies:

#### A. Percentage-Based Bonus

Example milestone rules:

*   7-day streak → +5%
*   14-day streak → +10%
*   30-day streak → +20%

##### Calculation rule

*   bonus is applied on the day the milestone is reached
*   bonus is calculated from the **base points earned in the last 5 days**
*   bonus excludes other bonus points
*   bonus becomes available immediately

#### B. Fixed Bonus

Example milestone rules:

*   7-day streak → +50 points
*   14-day streak → +150 points
*   30-day streak → +500 points

##### Calculation rule

*   bonus is granted immediately when the milestone is reached
*   bonus becomes available immediately

All milestone thresholds and bonus values should be configurable via settings.

***

## 6. Dashboard and User Experience

***

### 6.1 UX Direction

The app should feel like a **clean, modern, lightweight enhancement to Todoist**.

Design priorities:

*   intuitive to use
*   visually motivating
*   low friction
*   easy to extend over time
*   focused on clarity, not clutter

The interface should use **shadcn/ui** components for a modern and consistent design language.

***

### 6.2 Primary Home Screen: Dashboard

The **Dashboard** should be the main entry point into the app.

It should provide a motivational overview of the user’s current state, including:

*   current points balance
*   current streak
*   longest streak
*   progress toward next streak milestone
*   today’s tasks and their reward potential
*   recent points activity
*   reward redemption progress
*   quick access to the reward shop

The Dashboard should optimize for **motivation first**, while still helping the user decide what to work on next.

***

### 6.3 Secondary View: Task List

The task list should act as a planning-focused view.

It should display Todoist tasks together with their gamification metadata, such as:

*   priority
*   difficulty
*   estimated reward points
*   deadline indicators

The user should be able to sort or filter by:

*   priority
*   reward points
*   difficulty

Tasks with approaching deadlines should be visually highlighted.

***

### 6.4 Reward Shop View

A dedicated reward shop view should allow the user to:

*   browse rewards
*   see point costs
*   check affordability
*   redeem rewards
*   review reward details

This page should keep the motivation loop visible by clearly showing how close the user is to redeeming desired rewards.

***

### 6.5 Global Settings View

The app should include a **global settings page** where the user can configure core behavior.

Settings should cover:

#### Point calculation rules

*   priority multipliers
*   default completion bonus
*   scoring preferences

#### Streak rules

*   daily streak requirement
*   protection on/off
*   protection behavior settings
*   milestone bonus type
*   milestone bonus values

#### Reward catalog management

*   create rewards
*   edit rewards
*   archive or remove rewards

This settings page should centralize global preferences and keep the rest of the app simpler and more focused.

***

## 7. Page Structure and Templating

The app should use **Nuxt 4 page-based routing** with a clean separation of concerns.

At minimum, the app should include distinct views for:

*   **Dashboard**
*   **Task List**
*   **Reward Shop**
*   **Settings**

The structure should be designed so that:

*   pages are easy to extend
*   layouts can evolve without major restructuring
*   future features can be added cleanly
*   redesigns remain manageable

This routing and page structure should support long-term maintainability and scalability.

***

## 8. Analytics Scope

For the MVP, analytics should remain focused and lightweight.

### 8.1 Most Rewarding Projects

The app should show which projects generated the most points.

Primary metric:

*   **total points earned per project**

### 8.2 Streak History

The app should track and display:

*   current streak
*   longest streak
*   streak milestones reached

These metrics align well with the app’s core motivational purpose and are sufficient for an MVP.

***

## 9. Integration and Technical Architecture

***

### 9.1 Authentication

Authentication should use **Todoist OAuth**.

Requirements:

*   secure OAuth-based authorization
*   no local storage of username/password/email as app login credentials
*   user identity linked directly to Todoist account access

***

### 9.2 Sync and Completion Detection

The preferred integration method is **Todoist webhooks**.

#### Webhook Requirements

The app should support:

*   native task completion detection
*   secure cryptographic verification of incoming webhook requests
*   reliable retry-based delivery handling

#### App Responsibilities

To support reliable processing:

*   webhook handling must be **idempotent**
*   the app should acknowledge requests quickly
*   event processing should be safe against duplicates

#### Fallback Sync Strategy

If webhook integration is not feasible, the app should fall back to a scheduled sync job:

*   run nightly at **1:00 AM**
*   detect tasks completed in the previous day
*   award points accordingly

***

### 9.3 Database

The app should use **Neon** to store all app-specific data.

The database should store:

*   user account linkage
*   Todoist item mappings
*   extended metadata
*   rewards catalog
*   points balance
*   points transaction ledger
*   streak history
*   streak protection balance
*   reward redemption history
*   analytics support data
*   predefined milestone configuration

Although the initial product is single-user, the schema should be built so that **multi-user support can be added later** without redesigning the data model.

***

### 9.4 Points Ledger

The app should maintain a **full transaction ledger** as the authoritative history of point changes.

Each transaction should record:

*   timestamp
*   type (earned, spent, bonus, adjusted, etc.)
*   amount
*   description
*   trigger/source
*   related task, subtask, streak milestone, or reward where applicable

Manual adjustments should be allowed, but they must require a **documented reason**.

***

## 10. Domain Model Summary

The system should support the following core entities:

*   **User**
*   **Project**
*   **Task**
*   **Subtask**
*   **Task Metadata**
*   **Reward**
*   **Reward Redemption**
*   **Points Transaction**
*   **Streak**
*   **Streak Protection Balance**
*   **Badge**
*   **Milestone Definition** (streak-based for MVP)
*   **Settings**

This model should support both the current single-user use case and future multi-user expansion.

***

## 11. MVP Scope

### 11.1 In Scope

The MVP should include:

*   Todoist OAuth authentication
*   read-only Todoist sync
*   webhook-based completion detection
*   nightly sync fallback
*   Project / task / subtask mapping
*   metadata extension for Todoist items
*   percentage-based progress tracking using subtasks
*   configurable scoring formula
*   default difficulty-to-points mapping
*   default priority multipliers
*   optional completion bonus
*   points balance
*   full transaction ledger
*   streak tracking
*   automatic streak protection
*   predefined streak milestones
*   configurable streak bonus strategy
*   reward catalog
*   reward redemption
*   Dashboard page
*   Task List page
*   Reward Shop page
*   Settings page
*   basic analytics:
    *   most rewarding projects
    *   streak history

### 11.2 Out of Scope for MVP

The MVP should exclude:

*   modifying Todoist data
*   advanced analytics dashboards
*   social features
*   leaderboards
*   shared or multi-user reward systems
*   custom milestone grouping of tasks
*   milestone features beyond streak milestones

***

## 12. Implementation Principles

The solution should follow these principles:

*   Todoist is the source of truth for task state
*   the app is read-only relative to Todoist
*   progress should reward incremental effort
*   points logic must be transparent and configurable
*   the UI should be motivation-first
*   the architecture should support future expansion without early overengineering
*   page routing and domain structure should remain modular and maintainable

***

## 13. Conclusion

This project is a **gamified Todoist companion app** focused on motivation, consistency, and personal reward tracking.

It extends Todoist with:

*   configurable scoring
*   subtask-based progress recognition
*   reward redemption
*   streak mechanics
*   milestone bonuses
*   a full point ledger
*   a dashboard-centered experience

The product concept is now sufficiently defined to move into the next planning stage. The remaining work is no longer about requirements clarification, but about turning these decisions into:

*   architecture
*   schema design
*   page flows
*   implementation milestones