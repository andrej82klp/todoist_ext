# Product Requirements Document (PRD)

## Todoist Gamification Companion App

***

## 1. Document Overview

### Product Name

**Todoist Gamification Companion App**

### Product Type

Single-user productivity companion app with future multi-user readiness

### Platform

Web application built with **Nuxt 4**

### Purpose

This PRD defines the MVP requirements for a companion app that extends Todoist with gamification features such as points, streaks, reward redemption, and lightweight analytics.

***

## 2. Product Summary

The Todoist Gamification Companion App is designed to help users stay motivated and consistent by rewarding both **task completion** and **incremental progress**.

Todoist remains the source of truth for projects, tasks, and subtasks. This app overlays a gamification layer on top of Todoist by introducing:

*   progress-based scoring
*   configurable point rules
*   streak tracking
*   streak milestone bonuses
*   virtual rewards
*   reward redemption
*   a full transaction ledger
*   a motivation-first dashboard

The app is intended to improve follow-through and make productivity more engaging without replacing Todoist itself.

***

## 3. Problem Statement

Todoist is effective for organizing tasks, but it does not natively provide a strong system for:

*   rewarding incremental progress
*   turning completed work into a personal reward economy
*   maintaining visible streaks
*   reinforcing consistency through gamification
*   tracking point-based progress toward self-defined perks

As a result, long-term motivation can drop, especially for large or difficult tasks where progress may not feel immediately meaningful.

This app addresses that gap by making progress visible, measurable, and rewarding.

***

## 4. Goals and Objectives

### Primary Goal

Increase user motivation and consistency by gamifying task progress and completion from Todoist.

### Secondary Goals

*   Reward small steps, not only full completion
*   Encourage consistency through streaks and milestone bonuses
*   Create a transparent virtual points economy
*   Allow users to redeem points for real-world self-defined rewards
*   Provide a dashboard that reinforces progress and momentum

### MVP Objectives

*   Sync Todoist projects, tasks, and subtasks in read-only mode
*   Attach custom scoring metadata to Todoist items
*   Award points for completed subtasks and completed tasks
*   Track daily streaks and streak protection
*   Support configurable reward redemption
*   Maintain a complete points transaction history
*   Present all key progress indicators in a dashboard-first experience

***

## 5. Non-Goals

The MVP will **not**:

*   replace Todoist as a task manager
*   create, edit, or delete Todoist tasks
*   support team features or social competition
*   include public leaderboards
*   provide advanced analytics beyond core motivational metrics
*   support custom milestone grouping of tasks
*   implement complex collaborative or shared reward systems

***

## 6. Target User

### Primary User

A productivity-focused individual who already uses Todoist and wants additional motivation through gamification.

### Initial Scope

*   Single-user experience
*   Designed so the data model can support multi-user expansion later

***

## 7. Product Principles

The product should follow these principles:

*   **Todoist remains the source of truth**
*   **The app is read-only relative to Todoist**
*   **Progress should be rewarded, not just completion**
*   **Scoring logic must be transparent and configurable**
*   **The interface should prioritize motivation and clarity**
*   **The architecture should be scalable without unnecessary complexity**
*   **The page structure should support future redesign and extension**

***

## 8. User Experience Overview

The app should feel like a **clean, modern companion to Todoist**, not a competing task manager.

### UX Priorities

*   low friction
*   intuitive navigation
*   strong visibility of progress
*   clear points and streak feedback
*   quick access to rewards
*   minimal clutter
*   extensible structure for future features

### Design Direction

*   modern and lightweight interface
*   dashboard-first layout
*   shadcn/ui components
*   clear visual emphasis on progress, balance, and streaks

***

## 9. Core User Flows

### Flow 1: Connect Todoist Account

1.  User signs in via Todoist OAuth
2.  App connects to Todoist in read-only mode
3.  Projects, tasks, and subtasks are synced
4.  User lands on the dashboard

### Flow 2: Configure Metadata

1.  User opens a task or subtask in the app
2.  User assigns difficulty, priority, and optional scoring settings
3.  App stores the metadata in Neon
4.  Future completions use this metadata for point calculation

### Flow 3: Earn Points Through Progress

1.  User completes subtasks in Todoist
2.  App receives completion events via webhook
3.  Points are calculated and added to the user’s balance
4.  Progress on the related task is updated
5.  If all subtasks are completed, a fixed completion bonus (configured per parent task) is awarded

### Flow 4: Maintain or Protect a Streak

1.  User meets daily streak requirements through task completion or point earning
2.  App updates current streak
3.  If the user misses a qualifying day and protection is available, protection is consumed automatically
4.  User sees a notification the next day

### Flow 5: Redeem Rewards

1.  User opens Reward Shop
2.  User selects an available reward
3.  App checks available points
4.  If the balance is sufficient, redemption is allowed
5.  Points are deducted and the redemption is logged

### Flow 6: Manage Global Rules

1.  User opens Settings
2.  User changes scoring, streak, or reward configuration
3.  New rules apply going forward according to the implementation design

***

## 10. Functional Requirements

***

### 10.1 Todoist Integration

#### Requirements

*   The app must connect to Todoist via OAuth
*   The app must fetch Todoist projects, tasks, and subtasks
*   The app must operate in **read-only mode**
*   Todoist entities must map directly to corresponding app entities

#### Mapping

*   Todoist Project → App Project
*   Todoist Task → App Task
*   Todoist Subtask → App Subtask

#### Constraints

*   The app must not create, edit, or delete Todoist items
*   Todoist has no native milestone concept; milestone logic will exist only inside the app

***

### 10.2 Metadata Extension

The app must support app-specific metadata for Todoist items.

#### Metadata Fields

*   priority level
*   difficulty score
*   time estimate
*   points configuration
*   optional completion bonus
*   optional visual badges

#### Requirements

*   Metadata must be stored outside Todoist
*   Metadata must be linked to the related Todoist item
*   Metadata must be user-specific

***

### 10.3 Progress Tracking

Progress must be calculated for tasks using subtasks.

#### Rules

*   Only tasks with **one or more subtasks** are eligible for progress tracking
*   Tasks without subtasks are ignored by the app’s progress system
*   Progress must be percentage-based
*   Progress must recalculate if subtasks are added or removed later
*   Completed subtasks are assumed not to be reopened

#### Expected Outcome

Users should receive visible progress for larger tasks before the full task is completed.

***

### 10.4 Points System

The app must support a virtual points economy.

#### Points Can Be Earned From

*   completed subtasks
*   completed tasks
*   streak milestone bonuses
*   manual adjustments with a reason

#### Default Scoring Formula

**Base Points**

```text
Base points = Difficulty × 10
```

**Default Priority Multipliers**

*   Low = 1.0×
*   Medium = 1.25×
*   High = 1.5×

**Subtask Points**

```text
Subtask points = (Difficulty × 10) × Priority Multiplier
```

#### Requirements

*   The scoring formula must be configurable through global settings
*   Scoring must be transparent to the user
*   The user must be able to view earned points history

***

### 10.5 Task Completion Bonus

When all subtasks of a task are completed, the app awards a task completion bonus if one is configured for that task.

#### Rule

```text
Completion bonus = fixed integer points configured per parent task (default: 0)
```

#### Requirements

*   Completion bonus must be a fixed non-negative integer per parent task
*   Completion bonus is optional (0 = no bonus)
*   Bonus is awarded exactly once when all sibling subtasks complete
*   Bonus is not tied to a global percentage setting; each parent task configures its own bonus directly

***

### 10.6 Badges

Badges must exist as **visual-only achievements**.

#### Requirements

*   Badges may be displayed on the dashboard or task-related views
*   Badges must not alter point calculations
*   Badges must not affect redemption or streak calculations

***

### 10.7 Reward Catalog and Redemption

The app must support a user-managed reward catalog.

#### Reward Fields

*   name
*   point cost
*   optional category
*   optional description

#### Requirements

*   Users must be able to create, edit, and remove rewards
*   Rewards must be redeemable multiple times
*   Redemption must only be enabled when sufficient points are available
*   Redemptions must be recorded in history
*   Insufficient balance must disable redemption rather than fail late

***

## 11. Streak System Requirements

***

### 11.1 Streak Rules

The app must support configurable daily streak logic.

#### Supported Daily Conditions

*   complete at least one task or subtask
*   earn at least a minimum number of points

#### Requirements

*   The user must be able to choose the streak rule
*   The app must evaluate streak status daily
*   The current streak and longest streak must be tracked

***

### 11.2 Streak Protection

The app must support streak protection.

#### Default Rules

*   starting streak protection balance = 3 days
*   completing a 10-day streak grants +1 protection day

#### Behavior

*   streak protection must be applied automatically when a qualifying day is missed
*   the next day, the user must see a red notification banner at the bottom of the page
*   the banner must explain:
    *   that streak protection was used
    *   how many protection days remain
*   the banner must require user acknowledgement via dismissal

#### Settings

*   streak protection must be configurable
*   users must be able to disable it entirely

***

### 11.3 Streak Milestones

The MVP must include predefined streak-based milestones.

#### Default Examples

*   7-day streak
*   14-day streak
*   30-day streak

#### Requirements

*   milestones affect scoring through bonuses
*   milestones do not organize tasks
*   milestone thresholds must be configurable via settings

***

### 11.4 Streak Bonus Strategies

The app must support two user-selectable streak bonus strategies.

#### Strategy A: Percentage-Based Bonus

Example:

*   7-day streak → +5%
*   14-day streak → +10%
*   30-day streak → +20%

#### Rule

*   bonus is granted on the day the milestone is reached
*   bonus is based on **base points earned during the previous 5 days**
*   bonus excludes other bonus points

#### Strategy B: Fixed Bonus

Example:

*   7-day streak → +50
*   14-day streak → +150
*   30-day streak → +500

#### Rule

*   fixed bonus is granted immediately on milestone achievement

#### Requirements

*   users must be able to choose the strategy
*   values and thresholds must be configurable

***

## 12. Dashboard and Pages

The app must use **Nuxt 4 page-based routing** and a clear separation of concerns.

### Required MVP Pages

*   Dashboard
*   Task List
*   Reward Shop
*   Settings

***

### 12.1 Dashboard Page

The Dashboard is the primary home screen.

#### Must Display

*   current points balance
*   current streak
*   longest streak
*   progress toward the next streak milestone
*   today’s tasks and their reward potential
*   recent activity or point transactions
*   quick access to the reward shop

#### Goal

Provide a motivating overview that helps the user stay engaged and decide what to do next.

***

### 12.2 Task List Page

The Task List is the planning-oriented view.

#### Must Support

*   display of Todoist tasks and subtasks
*   metadata display:
    *   priority
    *   difficulty
    *   estimated reward points
    *   deadlines if available
*   sorting or filtering by:
    *   priority
    *   reward points
    *   difficulty

#### Additional Requirement

*   tasks with approaching deadlines should be highlighted

***

### 12.3 Reward Shop Page

The Reward Shop is the redemption-focused view.

#### Must Support

*   browsing available rewards
*   seeing point costs
*   seeing whether a reward is currently affordable
*   redeeming a reward
*   viewing reward details

***

### 12.4 Settings Page

The app must include a global settings page.

#### Settings Categories

**Point Calculation**

*   priority multipliers
*   default completion bonus
*   scoring preferences

**Streak Rules**

*   daily requirement rule
*   protection enabled/disabled
*   protection behavior configuration
*   milestone bonus type
*   milestone values and thresholds

**Reward Catalog**

*   create rewards
*   edit rewards
*   remove or archive rewards

#### Goal

Centralize global rules and keep the rest of the app simpler and more focused.

***

## 13. Analytics Requirements

Analytics for the MVP should remain minimal and motivation-focused.

### Required MVP Analytics

#### Most Rewarding Projects

*   total points earned per project

#### Streak History

*   current streak
*   longest streak
*   milestones reached

***

## 14. Data and Persistence Requirements

The app must use **Neon** as the database for app-specific data.

### Data to Store

*   user linkage to Todoist
*   Todoist item mappings
*   task metadata
*   reward catalog
*   reward redemption history
*   points balance
*   points transaction ledger
*   streak history
*   streak protection balance
*   milestone configuration
*   settings
*   analytics support data

### Scalability Requirement

Although the MVP is single-user, all records must be structured in a way that supports future multi-user expansion.

***

## 15. Points Ledger Requirements

The app must maintain a full transaction ledger.

### Each Transaction Must Include

*   timestamp
*   transaction type
*   amount
*   source/trigger
*   description
*   related entity reference where applicable

### Supported Types

*   earned
*   spent
*   bonus
*   adjusted

### Manual Adjustments

*   must be allowed
*   must require a documented reason

### Purpose

The ledger is the authoritative source for points history and transparency.

***

## 16. Integration and Sync Requirements

### 16.1 Authentication

*   Must use Todoist OAuth
*   Must not rely on local username/password/email authentication for app login

### 16.2 Preferred Sync Method

Use Todoist webhooks for task completion detection.

### Webhook Handling Requirements

*   support task completion detection
*   support cryptographic verification of webhook requests
*   support reliable retry delivery handling
*   processing must be idempotent
*   acknowledgements must be fast

### 16.3 Fallback Sync

If webhook integration is not feasible, the app must run a scheduled sync job.

#### Fallback Rule

*   nightly sync at 1:00 AM
*   checks tasks completed during the previous day
*   awards points accordingly

***

## 17. Domain Model

The MVP should support the following core domain entities:

*   User
*   Project
*   Task
*   Subtask
*   Task Metadata
*   Reward
*   Reward Redemption
*   Points Transaction
*   Streak
*   Streak Protection Balance
*   Badge
*   Milestone Definition
*   Settings

***

## 18. Success Metrics

The MVP should be considered successful if the user can:

*   connect their Todoist account successfully
*   see synced projects, tasks, and subtasks
*   configure metadata for relevant tasks
*   earn points for subtask completion
*   receive task completion bonuses
*   maintain and view streaks
*   see automatic streak protection behavior
*   redeem rewards successfully
*   view a complete points history
*   use the dashboard as the primary motivational interface

### Suggested Product Metrics

*   daily active usage
*   number of point-earning events per week
*   number of reward redemptions
*   streak retention over time
*   percentage of synced tasks with configured metadata

***

## 19. MVP Scope Summary

### In Scope

*   Todoist OAuth authentication
*   read-only Todoist sync
*   webhook-based completion detection
*   nightly fallback sync
*   project/task/subtask mapping
*   metadata extension
*   subtask-based progress tracking
*   configurable scoring logic
*   task completion bonus
*   points balance
*   points ledger
*   streak system
*   automatic streak protection
*   predefined streak milestones
*   configurable streak bonus strategy
*   reward catalog
*   reward redemption
*   dashboard
*   task list
*   reward shop
*   settings
*   minimal analytics

### Out of Scope

*   modifying Todoist data
*   advanced analytics
*   social features
*   leaderboards
*   shared rewards
*   collaborative workflows
*   custom milestone grouping

***

## 20. Risks and Considerations

### Technical Risks

*   webhook implementation must be reliable and idempotent
*   sync logic must avoid duplicate rewards
*   progress recalculation must remain consistent when subtasks change

### Product Risks

*   too much configurability could complicate the MVP
*   users may need transparency to trust scoring and streak behavior
*   reward mechanics should remain simple and understandable

### Mitigation

*   keep defaults sensible
*   make settings centralized
*   keep analytics lightweight
*   make all score changes visible in the points ledger

***

## 21. Future Considerations

Potential future enhancements may include:

*   multi-user support
*   shared or family reward systems
*   richer analytics
*   custom milestone types
*   milestone grouping for projects or goals
*   more advanced badge systems
*   notification preferences
*   mobile-friendly expansions
*   recurring or seasonal reward structures